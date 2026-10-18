#!/usr/bin/env python3
"""Check or explicitly update the preserved official Ax source bundle.

Default/--check is read-only. --update changes only the managed source tree and
source-manifest.json; curated references, semantic evidence and skills-lock.json
are never written. Publication or source changes require downstream integration
and a fresh semantic audit, not acceptance merely because download succeeded.
"""

import argparse
import gzip
import hashlib
import io
import json
import os
import re
import shutil
import sys
import tarfile
import tempfile
from pathlib import Path
from urllib.parse import urljoin, urlsplit
from urllib.request import Request, urlopen


SOURCE_ROOT = '.agents/skills/ax-llm'
INDEX_URL = 'https://ax-llm.github.io/ax/typescript/.well-known/agent-skills/index.json'
NPM_URL = 'https://registry.npmjs.org/@ax-llm/ax/{version}'
TOPICS = (
    'agent', 'agent-context', 'agent-memory-skills', 'agent-observability',
    'agent-optimize', 'agent-rlm', 'ai', 'audio', 'event-runtime', 'flow',
    'gen', 'gepa', 'mcp', 'playbook', 'refine', 'signature', 'typesafe',
)
DESTINATIONS = {
    'SKILL.md': ['SKILL.md', 'references/llm.md'],
    'references/quickstart.md': ['references/llm.md'],
    **{f'references/ax-{topic}.md': [f'references/{topic}.md'] for topic in TOPICS},
}
AUTHORED_REFERENCES = ['references/architecture.md']
MAX_JSON_BYTES = 1024 * 1024
MAX_DOWNLOAD_BYTES = 4 * 1024 * 1024
MAX_ARCHIVE_BYTES = 16 * 1024 * 1024
MAX_MEMBER_BYTES = 2 * 1024 * 1024
MAX_SOURCE_BYTES = 8 * 1024 * 1024
VERSION = r'\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?'
REVIEW_REQUIRED = 'Downstream implementation/design integration and fresh semantic audit review are required; downloaded sources are not semantic acceptance.'


class SyncError(ValueError):
    """Invalid publication, unsafe snapshot, or failed source transaction."""


def sha256(content):
    return hashlib.sha256(content).hexdigest()


def json_object(content, label):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise SyncError(f'{label}: duplicate JSON key {key!r}')
            result[key] = value
        return result

    try:
        result = json.loads(content, object_pairs_hook=unique)
    except (ValueError, UnicodeError) as exc:
        raise SyncError(f'{label}: invalid JSON: {exc}') from exc
    if not isinstance(result, dict):
        raise SyncError(f'{label}: expected a JSON object')
    return result


def checked_url(url):
    try:
        parts = urlsplit(url)
        if parts.scheme not in ('https', 'http') or not parts.hostname or parts.username or parts.password or parts.fragment:
            raise ValueError('expected an absolute HTTP(S) URL without credentials or fragment')
        parts.port
    except (ValueError, TypeError) as exc:
        raise SyncError(f'invalid publication URL {url!r}: {exc}') from exc
    return url


def fetch_bytes(url, max_bytes):
    """Bound every HTTP response, including responses without Content-Length."""
    request = Request(checked_url(url), headers={'Accept-Encoding': 'identity', 'User-Agent': 'ax-skills-source-sync/2'})
    with urlopen(request, timeout=30) as response:
        checked_url(response.geturl())
        length = response.headers.get('Content-Length')
        if length is not None and int(length) > max_bytes:
            raise SyncError(f'{url}: response exceeds {max_bytes} bytes')
        content = response.read(max_bytes + 1)
    if len(content) > max_bytes:
        raise SyncError(f'{url}: response exceeds {max_bytes} bytes')
    return content


def select_archive(index, index_url):
    """Select exactly the official bundled skill; its digest hashes the archive."""
    data = json_object(index, 'skill index')
    skills = data.get('skills')
    if not isinstance(skills, list):
        raise SyncError('skill index: skills must be an array')
    matches = [entry for entry in skills if isinstance(entry, dict) and entry.get('name') == 'ax-llm']
    if len(matches) != 1 or matches[0].get('type') != 'archive':
        raise SyncError('skill index: expected exactly one ax-llm archive')
    entry = matches[0]
    digest = entry.get('digest')
    if not isinstance(digest, str) or not re.fullmatch(r'sha256:[0-9a-f]{64}', digest):
        raise SyncError('skill index: ax-llm requires a SHA-256 archive digest')
    if not isinstance(entry.get('url'), str) or not entry['url']:
        raise SyncError('skill index: ax-llm requires an archive URL')
    return checked_url(urljoin(checked_url(index_url), entry['url'])), digest.removeprefix('sha256:')


def master_version(content):
    try:
        lines = content.decode('utf-8').splitlines()
        if not lines or lines[0] != '---':
            raise ValueError('missing frontmatter')
        metadata = lines[1:lines.index('---', 1)]
        names = [line for line in metadata if line.startswith('name:')]
        versions = [line for line in metadata if line.startswith('version:')]
        if names != ['name: ax-llm'] or len(versions) != 1:
            raise ValueError('expected one ax-llm name and version')
        value = versions[0].split(':', 1)[1].strip()
        if len(value) >= 2 and value[0] in ('"', "'") and value[-1] == value[0]:
            value = value[1:-1]
        if not re.fullmatch(VERSION, value):
            raise ValueError('invalid package version')
        return value
    except (ValueError, UnicodeError) as exc:
        raise SyncError(f'archive master: {exc}') from exc


def read_archive(content, expected_sha256):
    """Verify the compressed digest before bounded decompression; never extract."""
    if len(content) > MAX_DOWNLOAD_BYTES:
        raise SyncError('archive download exceeds the compressed size limit')
    if not isinstance(expected_sha256, str) or not re.fullmatch(r'[0-9a-f]{64}', expected_sha256) or sha256(content) != expected_sha256:
        raise SyncError('archive SHA-256 does not match the skill index')
    try:
        with gzip.GzipFile(fileobj=io.BytesIO(content)) as compressed:
            payload = compressed.read(MAX_ARCHIVE_BYTES + 1)
        if len(payload) > MAX_ARCHIVE_BYTES:
            raise SyncError('archive exceeds the decompressed size limit')
        members, seen, total = {}, set(), 0
        with tarfile.open(fileobj=io.BytesIO(payload), mode='r:') as archive:
            for entry in archive:
                name = entry.name.rstrip('/') if entry.isdir() else entry.name
                if name in seen:
                    raise SyncError(f'archive contains duplicate member {name!r}')
                seen.add(name)
                if len(seen) > len(DESTINATIONS) + 1:
                    raise SyncError('archive contains too many members')
                if entry.pax_headers or archive.pax_headers:
                    raise SyncError('archive extended metadata is not supported')
                if entry.isdir() and name == 'references':
                    continue
                if name not in DESTINATIONS:
                    raise SyncError(f'archive contains unexpected or unsafe path {name!r}')
                if not entry.isfile() or entry.type not in (tarfile.REGTYPE, tarfile.AREGTYPE) or entry.issparse():
                    raise SyncError(f'archive member is not an ordinary file: {name}')
                if entry.size < 0 or entry.size > MAX_MEMBER_BYTES:
                    raise SyncError(f'archive member exceeds size limit: {name}')
                total += entry.size
                if total > MAX_SOURCE_BYTES:
                    raise SyncError('archive source payload exceeds size limit')
                stream = archive.extractfile(entry)
                if stream is None:
                    raise SyncError(f'archive member cannot be read: {name}')
                with stream:
                    value = stream.read(MAX_MEMBER_BYTES + 1)
                if len(value) != entry.size:
                    raise SyncError(f'archive member is truncated: {name}')
                value.decode('utf-8')
                members[name] = value
        if set(members) != set(DESTINATIONS):
            raise SyncError(f'archive inventory mismatch: missing {sorted(set(DESTINATIONS) - set(members))}')
        master_version(members['SKILL.md'])
        return members
    except (OSError, EOFError, tarfile.TarError, UnicodeError) as exc:
        raise SyncError(f'invalid source archive: {exc}') from exc


def publication_identity(metadata, members, index_url, archive_url, archive_sha256):
    """Bind the bundled master version to that exact npm publication's gitHead."""
    version = master_version(members['SKILL.md'])
    if metadata.get('name') != '@ax-llm/ax' or metadata.get('version') != version:
        raise SyncError('npm package identity/version does not match the archive master')
    revision = metadata.get('gitHead')
    if not isinstance(revision, str) or not re.fullmatch(r'[0-9a-f]{40}', revision):
        raise SyncError('npm publication lacks a full gitHead revision')
    if not isinstance(archive_sha256, str) or not re.fullmatch(r'[0-9a-f]{64}', archive_sha256):
        raise SyncError('invalid archive SHA-256')
    return dict(package='@ax-llm/ax', version=version, git_commit=revision,
                index_url=checked_url(index_url), archive_url=checked_url(archive_url),
                archive_sha256=archive_sha256)


def fetch_publication(index_url=INDEX_URL, npm_url=NPM_URL, fetch=fetch_bytes):
    archive_url, digest = select_archive(fetch(index_url, MAX_JSON_BYTES), index_url)
    members = read_archive(fetch(archive_url, MAX_DOWNLOAD_BYTES), digest)
    version = master_version(members['SKILL.md'])
    metadata = json_object(fetch(npm_url.format(version=version), MAX_JSON_BYTES), 'npm publication')
    return members, publication_identity(metadata, members, index_url, archive_url, digest)


def manifest_for_bundle(members, upstream):
    if not isinstance(members, dict) or set(members) != set(DESTINATIONS):
        raise SyncError('cannot pin an incomplete or unexpected source inventory')
    total = 0
    for name, content in members.items():
        if not isinstance(content, bytes) or len(content) > MAX_MEMBER_BYTES:
            raise SyncError(f'invalid or oversized source member: {name}')
        total += len(content)
        if total > MAX_SOURCE_BYTES:
            raise SyncError('source payload exceeds size limit')
        try:
            content.decode('utf-8')
        except UnicodeError as exc:
            raise SyncError(f'source member is not UTF-8: {name}') from exc
    return {
        'schema_version': 2,
        'source_root': SOURCE_ROOT,
        'upstream': dict(upstream),
        'sources': [dict(source=f'{SOURCE_ROOT}/{name}', destinations=list(DESTINATIONS[name]),
                         sha256=sha256(members[name]), original_bytes=len(members[name]),
                         original_lines=len(members[name].splitlines())) for name in sorted(members)],
        'authored_references': list(AUTHORED_REFERENCES),
    }


def validate_manifest(data):
    fields = {'schema_version', 'source_root', 'upstream', 'sources', 'authored_references'}
    if set(data) != fields or type(data.get('schema_version')) is not int or data['schema_version'] != 2 or data.get('source_root') != SOURCE_ROOT:
        raise SyncError('source manifest must use exactly the frozen schema 2 fields/root')
    if data.get('authored_references') != AUTHORED_REFERENCES:
        raise SyncError('source manifest authored reference inventory differs from the frozen mapping')
    upstream = data.get('upstream')
    identity_fields = {'package', 'version', 'git_commit', 'index_url', 'archive_url', 'archive_sha256'}
    if not isinstance(upstream, dict) or set(upstream) != identity_fields or upstream['package'] != '@ax-llm/ax':
        raise SyncError('source manifest has an invalid publication identity')
    for field, pattern in (('version', VERSION), ('git_commit', r'[0-9a-f]{40}'), ('archive_sha256', r'[0-9a-f]{64}')):
        if not isinstance(upstream[field], str) or not re.fullmatch(pattern, upstream[field]):
            raise SyncError(f'source manifest has invalid upstream {field}')
    for field in ('index_url', 'archive_url'):
        checked_url(upstream[field])
    entries = data.get('sources')
    if not isinstance(entries, list):
        raise SyncError('source manifest sources must be an array')
    expected = {f'{SOURCE_ROOT}/{name}': targets for name, targets in DESTINATIONS.items()}
    seen = set()
    for entry in entries:
        if not isinstance(entry, dict) or set(entry) != {'source', 'destinations', 'sha256', 'original_bytes', 'original_lines'}:
            raise SyncError('source manifest has an invalid member entry')
        source = entry['source']
        if not isinstance(source, str) or source not in expected or source in seen or entry['destinations'] != expected[source]:
            raise SyncError(f'source manifest has an unexpected/duplicate source or mapping: {source!r}')
        seen.add(source)
        if not isinstance(entry['sha256'], str) or not re.fullmatch(r'[0-9a-f]{64}', entry['sha256']):
            raise SyncError(f'source manifest has invalid hash: {source}')
        for field in ('original_bytes', 'original_lines'):
            if type(entry[field]) is not int or entry[field] < 0:
                raise SyncError(f'source manifest has invalid {field}: {source}')
    if seen != {f'{SOURCE_ROOT}/{name}' for name in DESTINATIONS}:
        raise SyncError('source manifest does not pin the complete 19-source inventory')


def safe_path(repo, path):
    """Reject symlinks in managed targets and all ancestors inside the repo."""
    path = path.absolute()
    if not path.is_relative_to(repo) or '..' in path.parts:
        raise SyncError(f'managed path escapes repository: {path}')
    cursor = path
    while cursor != repo:
        if cursor.is_symlink():
            raise SyncError(f'managed path contains a symlink: {cursor}')
        cursor = cursor.parent
    return path


def local_snapshot(repo, manifest_path):
    repo = Path(repo).resolve()
    manifest_path = safe_path(repo, Path(manifest_path))
    manifest_bytes = manifest_path.read_bytes()
    if len(manifest_bytes) > MAX_JSON_BYTES:
        raise SyncError('local manifest exceeds size limit')
    data = json_object(manifest_bytes, 'source manifest')
    validate_manifest(data)
    root = safe_path(repo, repo / SOURCE_ROOT)
    if not root.is_dir():
        raise SyncError('managed source root does not exist')
    members = {}
    for path in root.rglob('*'):
        name = path.relative_to(root).as_posix()
        if path.is_symlink():
            raise SyncError(f'managed source tree contains a symlink: {name}')
        if path.is_dir() and name == 'references':
            continue
        if name not in DESTINATIONS or not path.is_file():
            raise SyncError(f'managed source tree contains unexpected path/type: {name}')
        if path.stat().st_size > MAX_MEMBER_BYTES:
            raise SyncError(f'managed source exceeds size limit: {name}')
        members[name] = path.read_bytes()
    if set(members) != set(DESTINATIONS):
        raise SyncError('managed source tree does not contain the exact 19-source inventory')
    return members, data, manifest_bytes


def compare_snapshot(members, manifest, published_members, upstream):
    """Return explicit local integrity, upstream byte and pinned identity drift."""
    messages = []
    actual = manifest_for_bundle(members, manifest['upstream'])
    if actual['sources'] != sorted(manifest['sources'], key=lambda entry: entry['source']):
        messages.append('Local source bytes/counts differ from manifest pins; downstream review is required.')
    if master_version(members['SKILL.md']) != manifest['upstream']['version']:
        messages.append('Local master version differs from the pinned publication.')
    for name in sorted(set(members) | set(published_members)):
        if members.get(name) != published_members.get(name):
            messages.append(f'Published source bytes/inventory differ: {name}')
    if manifest['upstream'] != upstream:
        messages.append('Published package/version/revision/archive identity differs from the manifest pin.')
    return messages


def update_snapshot(repo, manifest_path, members, upstream, replace=os.replace):
    """Stage completely, refuse local edits, and roll back ordinary write failures.

    This is a single-writer maintainer operation, not a crash-atomic transaction
    across two directories. Rollback failure retains named backups for recovery.
    """
    repo, manifest_path = Path(repo).resolve(), Path(manifest_path).absolute()
    old_members, old_manifest, old_bytes = local_snapshot(repo, manifest_path)
    old_pins = manifest_for_bundle(old_members, old_manifest['upstream'])
    if old_pins['sources'] != sorted(old_manifest['sources'], key=lambda entry: entry['source']) or master_version(old_members['SKILL.md']) != old_manifest['upstream']['version']:
        raise SyncError('refusing to overwrite locally modified managed sources; restore or review them explicitly')
    new_manifest = manifest_for_bundle(members, upstream)
    validate_manifest(new_manifest)
    if master_version(members['SKILL.md']) != upstream['version']:
        raise SyncError('new master version differs from publication identity')
    if old_members == members and old_manifest == new_manifest:
        return False
    root = repo / SOURCE_ROOT
    source_stage = Path(tempfile.mkdtemp(prefix='.ax-source-sync-', dir=root.parent))
    manifest_stage = None
    source_moved = manifest_moved = False
    rollback_ok = True
    try:
        manifest_stage = Path(tempfile.mkdtemp(prefix='.ax-manifest-sync-', dir=manifest_path.parent))
        bundle = source_stage / 'bundle'
        bundle.mkdir()
        for name, content in members.items():
            target = bundle / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
        staged_manifest = manifest_stage / 'new.json'
        staged_manifest.write_text(json.dumps(new_manifest, indent=2) + '\n', encoding='utf-8')
        # Refuse concurrent edits that appeared while the next snapshot was staged.
        current_members, _, current_bytes = local_snapshot(repo, manifest_path)
        if current_members != old_members or current_bytes != old_bytes:
            raise SyncError('snapshot changed while staging; no update was applied')
        replace(root, source_stage / 'old')
        source_moved = True
        replace(bundle, root)
        replace(manifest_path, manifest_stage / 'old.json')
        manifest_moved = True
        replace(staged_manifest, manifest_path)
    except BaseException as exc:
        try:
            if manifest_moved:
                os.replace(manifest_stage / 'old.json', manifest_path)
            if source_moved:
                if root.exists():
                    shutil.rmtree(root)
                os.replace(source_stage / 'old', root)
        except OSError as rollback_exc:
            rollback_ok = False
            raise SyncError(f'update failed ({exc}); rollback failed ({rollback_exc}); recover backups from {source_stage} and {manifest_stage}') from exc
        raise
    finally:
        if rollback_ok:
            for stage in (source_stage, manifest_stage):
                if stage is not None:
                    try:
                        shutil.rmtree(stage)
                    except OSError as cleanup_exc:
                        print(f'WARNING: remove retained staging/backup directory {stage}: {cleanup_exc}', file=sys.stderr)
    return True


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--check', action='store_true', help='read-only drift check (default)')
    mode.add_argument('--update', action='store_true', help='explicitly import validated source bytes and refresh manifest pins only')
    parser.add_argument('--repo', type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument('--collection', type=Path, default=Path('skills/ax-skills'))
    parser.add_argument('--index-url', default=INDEX_URL, help='skill discovery index URL; override only for an explicitly trusted publication/fixture')
    parser.add_argument('--npm-url', default=NPM_URL, help='npm version metadata URL; {version} expands to the archive master version')
    args = parser.parse_args(argv)
    repo = args.repo.resolve()
    collection = args.collection if args.collection.is_absolute() else repo / args.collection
    manifest_path = collection / 'assets/source-manifest.json'
    try:
        local_members, manifest, _ = local_snapshot(repo, manifest_path)
        members, upstream = fetch_publication(args.index_url, args.npm_url)
        drift = compare_snapshot(local_members, manifest, members, upstream)
        if args.update:
            changed = update_snapshot(repo, manifest_path, members, upstream)
            print('Updated preserved sources and source manifest only.' if changed else 'Preserved sources and publication pins are already current; no files changed.')
            if changed:
                print(REVIEW_REQUIRED)
            return 0
        if drift:
            for message in drift:
                print(f'DRIFT: {message}', file=sys.stderr)
            print(REVIEW_REQUIRED, file=sys.stderr)
            return 1
        print(f'Source check passed: 19 exact members; @ax-llm/ax {upstream["version"]}, revision {upstream["git_commit"]}; archive SHA-256 and member bytes match the manifest.')
        print('This read-only check does not validate curated implementation, architecture, or semantic audit freshness.')
        return 0
    except (OSError, ValueError, EOFError, tarfile.TarError) as exc:
        print(f'ERROR: {exc}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
