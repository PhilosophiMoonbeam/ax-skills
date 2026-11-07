#!/usr/bin/env python3
"""Collection discovery regressions with isolated, complete structural fixtures."""

import contextlib
import hashlib
import io
import json
import tempfile
import unittest
from pathlib import Path

import validate_ax_skills as validate


class CollectionDiscoveryTests(unittest.TestCase):
    def setUp(self):
        self.workspace = tempfile.TemporaryDirectory()
        self.addCleanup(self.workspace.cleanup)
        self.repo = Path(self.workspace.name)
        self.collection = self.repo / 'skills/ax-skills'
        entries = []
        destinations = set(validate.AUTHORED_REFERENCES)
        for source, targets in validate.EXPECTED.items():
            content = (b'---\nname: ax-llm\nversion: "25.4.9"\n---\n# Official\n'
                       if source.endswith('/SKILL.md') else b'# Official reference\n')
            path = self.repo / source
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
            entries.append(dict(source=source, destinations=list(targets),
                                sha256=hashlib.sha256(content).hexdigest(),
                                original_bytes=len(content), original_lines=len(content.splitlines())))
            destinations.update(targets)
        for destination in destinations - {'SKILL.md'}:
            self.write(destination, '# Reference\n')
        links = ''.join(f'[{name}]({name})\n' for name in sorted(destinations - {'SKILL.md'}))
        self.write('SKILL.md', '---\nname: ax-skills\ndescription: Collection fixture.\n---\n# Ax\n' + links)
        self.write('assets/source-manifest.json', json.dumps(dict(
            schema_version=2, source_root=validate.SOURCE_ROOT,
            upstream=dict(package='@ax-llm/ax', version='25.4.9', git_commit='a' * 40,
                          index_url='https://fixture.invalid/index.json',
                          archive_url='https://fixture.invalid/skill.tar.gz', archive_sha256='b' * 64),
            sources=entries, authored_references=sorted(validate.AUTHORED_REFERENCES),
        )))

    def write(self, relative, content):
        path = self.collection / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding='utf-8')
        return path

    def run_validator(self):
        validator = validate.Validator(self.repo, self.collection)
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            result = validator.run()
        return result, validator

    def test_dependency_entrypoints_and_broken_docs_are_not_collection_sources(self):
        self.write('examples/node_modules/vendor/SKILL.md', '# Third-party skill\n')
        self.write('examples/node_modules/vendor/README.md', '[Missing](missing.md)\n')
        self.write('examples/node_modules/vendor/nested/node_modules/other/broken.md', '[Bad](../../outside.md)\n')
        result, validator = self.run_validator()
        self.assertEqual(result, 0, validator.errors)
        self.assertFalse(any('node_modules' in path.parts for path in validator.documents))

    def test_generated_environments_and_caches_are_pruned(self):
        for directory in validate.GENERATED_DIRECTORIES:
            self.write(f'examples/{directory}/dependency/SKILL.md', '[Missing](missing.md)\n')
        result, validator = self.run_validator()
        self.assertEqual(result, 0, validator.errors)

    def test_real_reference_error_still_fails_with_dependencies_installed(self):
        self.write('examples/node_modules/vendor/SKILL.md', '# Dependency\n')
        self.write('references/architecture.md', '# Architecture\n[Missing](references/missing.md)\n')
        result, validator = self.run_validator()
        self.assertEqual(result, 1)
        self.assertTrue(any('references/architecture.md:2:' in error and 'local target does not exist' in error
                            for error in validator.errors), validator.errors)

    def test_hidden_source_and_examples_are_not_ignored(self):
        for relative in ('.source/guide.md', 'examples/guide.md'):
            with self.subTest(relative=relative):
                path = self.write(relative, '[Missing example](examples/missing.ts)\n')
                result, validator = self.run_validator()
                self.assertEqual(result, 1)
                self.assertTrue(any(relative + ':1:' in error and 'local target does not exist' in error
                                    for error in validator.errors), validator.errors)
                path.unlink()

    def test_source_entrypoints_and_symlink_escapes_still_fail(self):
        self.write('examples/source/SKILL.md', '# Extra source entrypoint\n')
        outside = self.repo / 'outside.md'
        outside.write_text('# Outside\n', encoding='utf-8')
        (self.collection / 'examples/escape.md').symlink_to(outside)
        self.write('examples/guide.md', '[Escape](../outside.md)\n')
        result, validator = self.run_validator()
        self.assertEqual(result, 1)
        self.assertTrue(any('collection entrypoints: unexpected examples/source/SKILL.md' in error
                            for error in validator.errors), validator.errors)
        self.assertTrue(any('Markdown symlink escapes collection' in error for error in validator.errors), validator.errors)
        self.assertTrue(any('path escapes allowed root' in error for error in validator.errors), validator.errors)

    def test_external_directory_symlink_cannot_hide_entrypoints_or_broken_markdown(self):
        outside = self.repo / 'external-source'
        outside.mkdir()
        (outside / 'SKILL.md').write_text('# Hidden entrypoint\n', encoding='utf-8')
        (outside / 'broken.md').write_text('[Missing](missing.md)\n', encoding='utf-8')
        self.write('examples/guide.md', '[Missing](examples/missing.md)\n')
        (self.collection / 'examples/external').symlink_to(outside, target_is_directory=True)
        result, validator = self.run_validator()
        self.assertEqual(result, 1)
        self.assertIn('examples/external: source directory symlink is not allowed', validator.errors)
        self.assertTrue(any('examples/guide.md:1:' in error and 'local target does not exist' in error
                            for error in validator.errors), validator.errors)

    def test_internal_directory_alias_is_rejected(self):
        source = self.write('examples/source/SKILL.md', '# Extra entrypoint\n').parent
        (self.collection / 'examples/alias').symlink_to(source, target_is_directory=True)
        result, validator = self.run_validator()
        self.assertEqual(result, 1)
        self.assertIn('examples/alias: source directory symlink is not allowed', validator.errors)
        self.assertTrue(any('collection entrypoints: unexpected examples/source/SKILL.md' in error
                            for error in validator.errors), validator.errors)

    def test_directory_symlink_cycle_is_rejected(self):
        examples = self.collection / 'examples'
        examples.mkdir()
        (examples / 'cycle').symlink_to(examples, target_is_directory=True)
        result, validator = self.run_validator()
        self.assertEqual(result, 1)
        self.assertIn('examples/cycle: source directory symlink is not allowed', validator.errors)

    def test_node_modules_directory_symlink_is_pruned(self):
        outside = self.repo / 'installed-dependencies'
        outside.mkdir()
        (outside / 'SKILL.md').write_text('# Dependency entrypoint\n', encoding='utf-8')
        (outside / 'broken.md').write_text('[Missing](missing.md)\n', encoding='utf-8')
        examples = self.collection / 'examples'
        examples.mkdir()
        (examples / 'node_modules').symlink_to(outside, target_is_directory=True)
        result, validator = self.run_validator()
        self.assertEqual(result, 0, validator.errors)
        self.assertFalse(any('node_modules' in path.parts for path in validator.documents))


if __name__ == '__main__':
    unittest.main()
