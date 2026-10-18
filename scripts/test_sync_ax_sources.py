#!/usr/bin/env python3
"""Isolated archive integrity, drift, and source-update failure regressions."""

import contextlib
import gzip
import http.server
import io
import json
import os
import tarfile
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import sync_ax_sources as sync


def source_members(version='25.4.3'):
    members = {name: f'# {name}\nSource fixture.\n'.encode() for name in sync.DESTINATIONS}
    members['SKILL.md'] = f'---\nname: ax-llm\nversion: "{version}"\n---\n# Ax\n'.encode()
    return members


def archive_bytes(members, extra=()):
    payload = io.BytesIO()
    with tarfile.open(fileobj=payload, mode='w', format=tarfile.USTAR_FORMAT) as archive:
        for name, content in members.items():
            entry = tarfile.TarInfo(name)
            entry.size = len(content)
            archive.addfile(entry, io.BytesIO(content))
        for entry, content in extra:
            archive.addfile(entry, io.BytesIO(content) if content is not None else None)
    return gzip.compress(payload.getvalue(), mtime=0)


def identity(members, archive=None, index_url='https://fixture.invalid/index.json'):
    archive = archive_bytes(members) if archive is None else archive
    return sync.publication_identity(
        dict(name='@ax-llm/ax', version=sync.master_version(members['SKILL.md']), gitHead='a' * 40),
        members, index_url, index_url.rsplit('/', 1)[0] + '/skill.tar.gz', sync.sha256(archive),
    )


@contextlib.contextmanager
def publication_server(members, archive_override=None):
    archive = archive_bytes(members)
    bodies = {
        '/index.json': json.dumps({'skills': [dict(name='ax-llm', type='archive', url='skill.tar.gz', digest='sha256:' + sync.sha256(archive))]}).encode(),
        '/skill.tar.gz': archive if archive_override is None else archive_override,
        '/npm': json.dumps(dict(name='@ax-llm/ax', version=sync.master_version(members['SKILL.md']), gitHead='a' * 40)).encode(),
    }

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            body = bodies.get(self.path)
            self.send_response(200 if body is not None else 404)
            self.end_headers()
            if body is not None:
                self.wfile.write(body)

        def log_message(self, *_):
            pass

    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f'http://127.0.0.1:{server.server_port}'
        yield base + '/index.json', base + '/npm'
    finally:
        server.shutdown()
        thread.join()
        server.server_close()


class ArchiveIntegrityTests(unittest.TestCase):
    def test_exact_member_bytes_survive_digest_verified_archive(self):
        members = source_members()
        archive = archive_bytes(members)
        self.assertEqual(sync.read_archive(archive, sync.sha256(archive)), members)
        with self.assertRaises(sync.SyncError):
            sync.read_archive(archive, '0' * 64)

    def test_unexpected_and_aliased_paths_never_escape(self):
        for name in ('../outside.md', '/outside.md', 'references/../../outside.md', 'references\\outside.md', './SKILL.md', 'unmanaged.md'):
            with self.subTest(name=name):
                entry = tarfile.TarInfo(name)
                entry.size = 1
                archive = archive_bytes(source_members(), [(entry, b'x')])
                with self.assertRaises(sync.SyncError):
                    sync.read_archive(archive, sync.sha256(archive))

    def test_duplicate_members_and_nonregular_types_are_rejected(self):
        members = source_members()
        duplicate = tarfile.TarInfo('SKILL.md')
        duplicate.size = 1
        archive = archive_bytes(members, [(duplicate, b'x')])
        with self.assertRaises(sync.SyncError):
            sync.read_archive(archive, sync.sha256(archive))
        for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.FIFOTYPE, tarfile.CHRTYPE, tarfile.DIRTYPE):
            with self.subTest(kind=kind):
                entry = tarfile.TarInfo('SKILL.md')
                entry.type = kind
                entry.linkname = '../outside'
                archive = archive_bytes({name: value for name, value in members.items() if name != 'SKILL.md'}, [(entry, None)])
                with self.assertRaises(sync.SyncError):
                    sync.read_archive(archive, sync.sha256(archive))

    def test_missing_and_non_utf8_sources_are_rejected(self):
        for replacement in (None, b'\xff'):
            members = source_members()
            if replacement is None:
                del members['references/quickstart.md']
            else:
                members['references/quickstart.md'] = replacement
            archive = archive_bytes(members)
            with self.assertRaises(sync.SyncError):
                sync.read_archive(archive, sync.sha256(archive))

    def test_bounded_decompression_and_member_payload(self):
        archive = archive_bytes(source_members())
        with patch.object(sync, 'MAX_ARCHIVE_BYTES', 1024):
            with self.assertRaises(sync.SyncError):
                sync.read_archive(archive, sync.sha256(archive))
        with patch.object(sync, 'MAX_MEMBER_BYTES', 8):
            with self.assertRaises(sync.SyncError):
                sync.read_archive(archive, sync.sha256(archive))
        with publication_server(source_members()) as (index_url, _):
            with self.assertRaises(sync.SyncError):
                sync.fetch_bytes(index_url, 8)

    def test_archive_version_must_match_exact_npm_identity(self):
        members = source_members()
        for metadata in (
            dict(name='wrong-package', version='25.4.3', gitHead='a' * 40),
            dict(name='@ax-llm/ax', version='25.4.4', gitHead='a' * 40),
            dict(name='@ax-llm/ax', version='25.4.3', gitHead='short'),
        ):
            with self.subTest(metadata=metadata):
                with self.assertRaises(sync.SyncError):
                    sync.publication_identity(metadata, members, sync.INDEX_URL, sync.INDEX_URL, 'b' * 64)


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.workspace = tempfile.TemporaryDirectory()
        self.addCleanup(self.workspace.cleanup)
        self.repo = Path(self.workspace.name)
        self.members = source_members()
        self.upstream = identity(self.members)
        self.manifest = sync.manifest_for_bundle(self.members, self.upstream)
        self.manifest_path = self.repo / 'skills/ax-skills/assets/source-manifest.json'
        self.manifest_path.parent.mkdir(parents=True)
        self.manifest_path.write_text(json.dumps(self.manifest, indent=2) + '\n', encoding='utf-8')
        for name, content in self.members.items():
            path = self.repo / sync.SOURCE_ROOT / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
        for relative in ('skills/ax-skills/SKILL.md', 'skills/ax-skills/references/architecture.md', 'skills/ax-skills/assets/coverage-audit.json', 'skills-lock.json'):
            path = self.repo / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b'curated; must remain unchanged\n')

    def files(self):
        return {path.relative_to(self.repo).as_posix(): path.read_bytes() for path in self.repo.rglob('*') if path.is_file()}

    def next_publication(self):
        members = dict(self.members)
        members['references/quickstart.md'] += b'New official source.\n'
        return members, identity(members)

    def test_http_check_detects_drift_without_mutation_then_update_preserves_curated(self):
        members, _ = self.next_publication()
        before = self.files()
        with publication_server(members) as (index_url, npm_url):
            published, upstream = sync.fetch_publication(index_url, npm_url)
            local, manifest, _ = sync.local_snapshot(self.repo, self.manifest_path)
            self.assertTrue(sync.compare_snapshot(local, manifest, published, upstream))
            self.assertEqual(self.files(), before)
            self.assertTrue(sync.update_snapshot(self.repo, self.manifest_path, published, upstream))
            local, manifest, _ = sync.local_snapshot(self.repo, self.manifest_path)
            self.assertEqual(sync.compare_snapshot(local, manifest, published, upstream), [])
        after = self.files()
        for name, content in before.items():
            if name != self.manifest_path.relative_to(self.repo).as_posix() and not name.startswith(sync.SOURCE_ROOT + '/'):
                self.assertEqual(after[name], content)
        self.assertEqual(local, members)

    def test_invalid_http_archive_cannot_modify_snapshot(self):
        members, _ = self.next_publication()
        before = self.files()
        with publication_server(members, archive_override=b'not the indexed archive') as (index_url, npm_url):
            with contextlib.redirect_stderr(io.StringIO()):
                result = sync.main(['--update', '--repo', str(self.repo), '--index-url', index_url, '--npm-url', npm_url])
        self.assertEqual(result, 1)
        self.assertEqual(self.files(), before)

    def test_local_source_edits_refuse_update_and_preserve_every_file(self):
        target = self.repo / sync.SOURCE_ROOT / 'references/quickstart.md'
        target.write_bytes(target.read_bytes() + b'local edit\n')
        before = self.files()
        members, upstream = self.next_publication()
        with self.assertRaises(sync.SyncError):
            sync.update_snapshot(self.repo, self.manifest_path, members, upstream)
        self.assertEqual(self.files(), before)

    def test_unmanaged_files_and_symlinks_refuse_update(self):
        members, upstream = self.next_publication()
        extra = self.repo / sync.SOURCE_ROOT / 'local.txt'
        extra.write_bytes(b'user data')
        before = self.files()
        with self.assertRaises(sync.SyncError):
            sync.update_snapshot(self.repo, self.manifest_path, members, upstream)
        self.assertEqual(self.files(), before)
        extra.unlink()
        target = self.repo / sync.SOURCE_ROOT / 'references/quickstart.md'
        target.unlink()
        target.symlink_to(self.repo / 'skills-lock.json')
        with self.assertRaises(sync.SyncError):
            sync.update_snapshot(self.repo, self.manifest_path, members, upstream)
        self.assertTrue(target.is_symlink())
        self.assertEqual((self.repo / 'skills-lock.json').read_bytes(), b'curated; must remain unchanged\n')

    def test_each_commit_rename_failure_restores_source_and_manifest_bytes(self):
        members, upstream = self.next_publication()
        before = self.files()
        for failure in range(1, 5):
            with self.subTest(failure=failure):
                calls = 0

                def failing_replace(source, destination):
                    nonlocal calls
                    calls += 1
                    if calls == failure:
                        raise OSError('injected commit rename failure')
                    return os.replace(source, destination)

                with self.assertRaises(OSError):
                    sync.update_snapshot(self.repo, self.manifest_path, members, upstream, replace=failing_replace)
                self.assertEqual(self.files(), before)

    def test_staging_failure_leaves_originals_intact(self):
        members, upstream = self.next_publication()
        before = self.files()
        write_bytes = Path.write_bytes

        def fail_staged_write(path, value):
            if '.ax-source-sync-' in str(path):
                raise OSError('injected staging failure')
            return write_bytes(path, value)

        with patch.object(Path, 'write_bytes', fail_staged_write):
            with self.assertRaises(OSError):
                sync.update_snapshot(self.repo, self.manifest_path, members, upstream)
        self.assertEqual(self.files(), before)

    def test_revision_only_and_local_pin_drift_are_not_accepted(self):
        changed_identity = dict(self.upstream, git_commit='b' * 40)
        self.assertTrue(sync.compare_snapshot(self.members, self.manifest, self.members, changed_identity))
        manifest = json.loads(json.dumps(self.manifest))
        manifest['sources'][0]['sha256'] = '0' * 64
        self.assertTrue(sync.compare_snapshot(self.members, manifest, self.members, self.upstream))


if __name__ == '__main__':
    unittest.main()
