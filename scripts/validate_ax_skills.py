#!/usr/bin/env python3
"""Validate Ax collection structure and immutable source provenance, not semantics.

Run: python3 scripts/validate_ax_skills.py [--repo PATH] [--collection PATH]
Collection paths are relative to --repo unless absolute. Local Markdown links
are relative to the collection root, including links inside references. This
standard-library maintainer tool never rewrites files or stamps audit results.
Frontmatter supports ordinary YAML scalars, block scalars and string mappings;
advanced YAML features (tags, anchors and aliases) are rejected explicitly.
Semantic coverage is reviewed separately by the orchestrator's judge_batch.
"""

import argparse
import hashlib
import html
import json
import re
import sys
from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urlsplit


TOPICS = (
    "agent", "agent-context", "agent-memory-skills", "agent-observability",
    "agent-optimize", "agent-rlm", "ai", "audio", "event-runtime", "flow",
    "gen", "gepa", "llm", "mcp", "playbook", "refine", "signature", "typesafe",
)
SOURCE_ROOT = ".agents/skills/ax-llm"
EXPECTED = {
    f"{SOURCE_ROOT}/SKILL.md": ("SKILL.md", "references/llm.md"),
    f"{SOURCE_ROOT}/references/quickstart.md": ("references/llm.md",),
    **{
        f"{SOURCE_ROOT}/references/ax-{topic}.md": (f"references/{topic}.md",)
        for topic in TOPICS if topic != "llm"
    },
}
AUTHORED_REFERENCES = {"references/architecture.md"}
OLD_NAMES = r"(?<![\w@/.-])ax-(?:" + "|".join(sorted(TOPICS, key=len, reverse=True)) + r")(?![\w/-]|\.[\w])"
OLD_PATH = re.compile(
    r"(?<![\w@.-])(?:skill://ax-[\w-]+(?![\w-])|"
    r"(?:\.agents/)?skills/ax-[\w-]+/SKILL\.md(?![\w-]|\.[\w]))", re.I,
)
OLD_LOADING = re.compile(
    r"\b(?:load|read|use|open|consult|install|invoke|activate|see)\s+"
    r"(?:(?:the|an?|original|installed|standalone|separate)\s+)*"
    r"(?:skill\s+)?" + OLD_NAMES + r"(?:\s+skill)?", re.I,
)
FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})(.*)$")
INLINE_CODE = re.compile(r"(`+)(?!`)(.*?)(?<!`)\1(?!`)", re.S)


def original_loading_instruction(line):
    """Recognize original skill routes, not package/API examples or prohibitions."""
    # Preserve inline-code skill names/paths used as prose instruction operands,
    # but hide code expressions and quoted dynamic-skill API arguments.
    line = INLINE_CODE.sub(
        lambda match: match[2] if (
            re.fullmatch(OLD_NAMES, match[2], re.I)
            or OLD_PATH.fullmatch(match[2])
        ) else ' ' * len(match[0]),
        line,
    )
    # Negation applies to its clause, never to a later contrasting instruction.
    for clause in re.split(r"[;!?]|\.(?=\s|$)|\b(?:but|however|instead)\b", line, flags=re.I):
        for match in list(OLD_PATH.finditer(clause)) + list(OLD_LOADING.finditer(clause)):
            before, operand, after = clause[:match.start()], match[0], clause[match.end():]
            if re.search(
                r"\b(?:not|never|no|without|avoid|rather\s+than)\b"
                r"[^,:\n]{0,100}$|(?:don't|doesn't|isn't|aren't|needn't)\s*$",
                before, re.I,
            ):
                continue
            if re.search(r"\b(?:not|never|without)\b", operand, re.I):
                continue
            if re.match(
                r"\s*(?:skill\s+)?(?:is|are|was|were)?\s*"
                r"(?:not\s+(?:required|needed|necessary|used)|"
                r"(?:isn't|aren't)\s+(?:required|needed|necessary|used))\b",
                after, re.I,
            ):
                continue
            return True
    return False


def split_yaml(text, delimiter):
    """Split a small YAML scalar/mapping without splitting quoted content."""
    parts, start, quote = [], 0, None
    i = 0
    while i < len(text):
        char = text[i]
        if quote:
            if char == "\\" and quote == '"':
                i += 2
                continue
            if char == quote:
                if quote == "'" and i + 1 < len(text) and text[i + 1] == "'":
                    i += 2
                    continue
                quote = None
        elif char in "\"'":
            quote = char
        elif char == delimiter:
            parts.append(text[start:i])
            start = i + 1
        i += 1
    if quote:
        raise ValueError("unterminated YAML quote")
    return parts + [text[start:]]


def yaml_scalar(raw):
    raw = raw.strip()
    if not raw:
        return None
    if raw.startswith('"'):
        parts = split_yaml(raw, '#')
        return json.loads(parts[0].strip())
    if raw.startswith("'"):
        parts = split_yaml(raw, '#')
        value = parts[0].strip()
        if not value.endswith("'"):
            raise ValueError("unterminated YAML string")
        return value[1:-1].replace("''", "'")
    raw = re.split(r"\s+#", raw, maxsplit=1)[0].rstrip()
    if raw.startswith(("&", "*", "!")):
        raise ValueError("YAML anchors, aliases and tags are unsupported; use literal values")
    if raw.startswith("{") and raw.endswith("}"):
        result = {}
        for item in split_yaml(raw[1:-1], ','):
            if not item.strip():
                continue
            pair = split_yaml(item, ':')
            if len(pair) < 2:
                raise ValueError("invalid YAML inline mapping")
            key = yaml_scalar(pair[0])
            if not isinstance(key, str) or key in result:
                raise ValueError("YAML mapping keys must be unique strings")
            result[key] = yaml_scalar(':'.join(pair[1:]))
        return result
    if raw.startswith("["):
        return json.loads(raw)
    if raw.lower() in ("null", "~", "true", "false", "yes", "no", "on", "off"):
        return None if raw.lower() in ("null", "~") else raw.lower() in ("true", "yes", "on")
    if re.fullmatch(r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?", raw):
        return float(raw) if any(c in raw for c in '.eE') else int(raw)
    return raw


def frontmatter(lines):
    if not lines or lines[0] != "---":
        raise ValueError("SKILL.md must start with YAML frontmatter delimiter '---'")
    try:
        end = lines.index("---", 1)
    except ValueError:
        raise ValueError("missing closing YAML frontmatter delimiter '---'") from None
    result, i = {}, 1
    while i < end:
        line = lines[i]
        if not line.strip() or line.lstrip().startswith('#'):
            i += 1
            continue
        match = re.fullmatch(r"([A-Za-z][\w-]*):(?:\s+(.*))?", line)
        if not match:
            raise ValueError(f"frontmatter line {i + 1}: expected a top-level key/value")
        key, raw = match.group(1), match.group(2) or ""
        if key in result:
            raise ValueError(f"duplicate frontmatter key {key!r}")
        i += 1
        if re.fullmatch(r"[|>][+-]?", raw):
            block = []
            while i < end and (not lines[i].strip() or lines[i].startswith(' ')):
                block.append(lines[i])
                i += 1
            indent = min((len(s) - len(s.lstrip()) for s in block if s.strip()), default=0)
            values = [s[indent:] for s in block]
            if raw[0] == '|':
                value = '\n'.join(values)
            else:
                value = ''
                for index, part in enumerate(values):
                    if index:
                        value += '\n' if not part or not values[index - 1] else ' '
                    value += part
            if raw.endswith('-'):
                value = value.rstrip('\n')
            elif raw.endswith('+'):
                value += '\n'
            else:
                value = value.rstrip('\n') + '\n'
            result[key] = value
        elif not raw:
            values = {}
            while i < end and (not lines[i].strip() or lines[i].startswith(' ')):
                item = lines[i].strip()
                i += 1
                if not item or item.startswith('#'):
                    continue
                pair = split_yaml(item, ':')
                if len(pair) < 2:
                    raise ValueError(f"frontmatter line {i}: expected a string mapping")
                subkey = yaml_scalar(pair[0])
                if not isinstance(subkey, str) or subkey in values:
                    raise ValueError(f"frontmatter line {i}: mapping keys must be unique strings")
                values[subkey] = yaml_scalar(':'.join(pair[1:]))
            result[key] = values if values else None
        else:
            result[key] = yaml_scalar(raw)
    return result, end + 1


def prose_lines(lines, label, errors):
    """Blank fenced code while preserving line numbers; diagnose unclosed fences."""
    output, active, opened = [], None, None
    for number, line in enumerate(lines, 1):
        match = FENCE.match(line)
        if active:
            if match and match[1][0] == active[0] and len(match[1]) >= len(active) and not match[2].strip():
                active = None
            output.append('')
        elif match:
            if match[1][0] == '`' and '`' in match[2]:
                output.append(line)
                continue
            active, opened = match[1], number
            output.append('')
        else:
            output.append(line)
    if active:
        errors.append(f"{label}:{opened}: unclosed {active[0]} fence")
    return output


def heading_ids(lines):
    identifiers, counts = set(), {}
    previous = ''
    for line in lines:
        for match in re.finditer(r"\b(?:id|name)\s*=\s*([\"'])(.*?)\1", line, re.I):
            identifiers.add(html.unescape(match[2]))
        match = re.match(r"^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$", line)
        title = match[1] if match else (previous if re.fullmatch(r" {0,3}(?:=+|-+)\s*", line) else None)
        if title is not None:
            title = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", title)
            title = html.unescape(re.sub(r"<[^>]+>", '', title)).lower().strip()
            slug = ''.join(c for c in title if c.isalnum() or c in '_- ')
            slug = slug.replace(' ', '-')
            suffix = counts.get(slug, 0)
            counts[slug] = suffix + 1
            identifiers.add(slug if suffix == 0 else f"{slug}-{suffix}")
        previous = line.strip()
    return identifiers


def destination_at(text, start):
    """Parse a Markdown destination, preserving balanced URL parentheses."""
    i = start
    while i < len(text) and text[i].isspace():
        i += 1
    if i < len(text) and text[i] == '<':
        end = text.find('>', i + 1)
        if end < 0:
            raise ValueError("unterminated angle-bracket link destination")
        return text[i + 1:end], end + 1
    value, depth = [], 0
    while i < len(text):
        char = text[i]
        if char == '\\' and i + 1 < len(text):
            value.append(text[i + 1])
            i += 2
            continue
        if char == '(':
            depth += 1
        elif char == ')':
            if depth == 0:
                break
            depth -= 1
        elif char.isspace() and depth == 0:
            break
        value.append(char)
        i += 1
    if depth:
        raise ValueError("unbalanced parentheses in link destination")
    return ''.join(value), i


def markdown_links(lines, label, errors):
    """Read inline, reference-style, autolink and HTML links outside code."""
    text = INLINE_CODE.sub(lambda m: ' ' * len(m[0]), '\n'.join(lines))
    definitions, links = {}, []
    normalize = lambda value: ' '.join(value.split()).casefold()
    for number, line in enumerate(text.splitlines(), 1):
        match = re.match(r"^ {0,3}\[([^\]]+)\]:\s*(.*)$", line)
        if match:
            try:
                target, _ = destination_at(match[2], 0)
                definitions[normalize(match[1])] = target
                links.append((target, number))
            except ValueError as exc:
                errors.append(f"{label}:{number}: {exc}")
    # Scan brackets rather than assuming URLs cannot contain parentheses.
    i = 0
    while i < len(text):
        if text[i] == '\\':
            i += 2
            continue
        if text[i] != '[':
            i += 1
            continue
        start, depth = i, 1
        i += 1
        while i < len(text) and depth:
            if text[i] == '\\':
                i += 2
                continue
            depth += (text[i] == '[') - (text[i] == ']')
            i += 1
        if depth:
            continue
        caption = text[start + 1:i - 1]
        number = text.count('\n', 0, start) + 1
        if i < len(text) and text[i] == '(':
            try:
                target, end = destination_at(text, i + 1)
                # An optional title may follow the destination.
                title_end = re.match(r"\s*(?:\"[^\"]*\"|'[^']*'|\([^)]*\))?\s*\)", text[end:])
                if not title_end:
                    raise ValueError("unterminated or malformed Markdown link")
                links.append((target, number))
                i = end + title_end.end()
            except ValueError as exc:
                errors.append(f"{label}:{number}: {exc}")
        elif i < len(text) and text[i] == '[':
            end = text.find(']', i + 1)
            if end >= 0:
                key = normalize(text[i + 1:end] or caption)
                if key not in definitions:
                    errors.append(f"{label}:{number}: undefined link reference {key!r}")
                else:
                    links.append((definitions[key], number))
                i = end + 1
        elif normalize(caption) in definitions:
            links.append((definitions[normalize(caption)], number))
    for match in re.finditer(r"<([^<>\s]+)>|\b(?:href|src)\s*=\s*([\"'])(.*?)\2", text, re.I):
        target = match[1] or match[3]
        if match[1] and not (re.match(r"[A-Za-z][\w+.-]*:", target) or target.startswith(('references/', 'assets/', '#'))):
            continue
        links.append((html.unescape(target), text.count('\n', 0, match.start()) + 1))
    return links


class Validator:
    def __init__(self, repo, collection):
        self.repo, self.collection = repo.resolve(), collection.resolve()
        self.errors, self.documents, self.anchors = [], {}, {}
        self.link_count, self.source_bytes, self.source_lines = 0, 0, 0

    def error(self, message):
        self.errors.append(message)

    def inside(self, base, relative, label):
        if not isinstance(relative, str) or not relative or '\\' in relative:
            self.error(f"{label}: expected a nonempty POSIX relative path")
            return None
        path = PurePosixPath(relative)
        if path.is_absolute():
            self.error(f"{label}: absolute path is not collection-root-relative: {relative}")
            return None
        candidate = (base / relative).resolve()
        if not candidate.is_relative_to(base):
            self.error(f"{label}: path escapes allowed root: {relative}")
            return None
        return candidate

    def read_json(self, path):
        def unique(pairs):
            result = {}
            for key, value in pairs:
                if key in result:
                    raise ValueError(f"duplicate JSON key {key!r}")
                result[key] = value
            return result

        try:
            return json.loads(path.read_text(encoding='utf-8'), object_pairs_hook=unique)
        except (OSError, UnicodeError, ValueError) as exc:
            self.error(f"{path}: cannot read JSON: {exc}")
            return None

    def manifest(self):
        data = self.read_json(self.collection / 'assets/source-manifest.json')
        if not isinstance(data, dict):
            self.error("source manifest must be a JSON object")
            return set()
        if set(data) != {'schema_version', 'source_root', 'upstream', 'sources', 'authored_references'}:
            self.error("source manifest must contain exactly the schema 2 fields")
        if type(data.get('schema_version')) is not int or data.get('schema_version') != 2 or data.get('source_root') != SOURCE_ROOT:
            self.error("source manifest must use schema_version 2 and the frozen source_root")
        upstream = data.get('upstream')
        upstream_fields = {'package', 'version', 'git_commit', 'index_url', 'archive_url', 'archive_sha256'}
        if not isinstance(upstream, dict) or set(upstream) != upstream_fields:
            self.error("source manifest upstream must contain the complete publication identity")
        else:
            if upstream['package'] != '@ax-llm/ax':
                self.error("source manifest upstream package must be @ax-llm/ax")
            for field, pattern in (
                ('version', r'\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?'),
                ('git_commit', r'[0-9a-f]{40}'),
                ('archive_sha256', r'[0-9a-f]{64}'),
            ):
                if not isinstance(upstream[field], str) or not re.fullmatch(pattern, upstream[field]):
                    self.error(f"source manifest upstream {field} is invalid")
            for field in ('index_url', 'archive_url'):
                try:
                    parts = urlsplit(upstream[field]) if isinstance(upstream[field], str) else None
                    if not parts or parts.scheme not in ('https', 'http') or not parts.netloc or parts.username or parts.password or parts.fragment:
                        raise ValueError("expected an absolute HTTP(S) URL without credentials or fragment")
                except ValueError as exc:
                    self.error(f"source manifest upstream {field}: {exc}")
        authored = data.get('authored_references')
        if not isinstance(authored, list) or any(not isinstance(path, str) for path in authored):
            self.error("source manifest authored_references must be an array of paths")
        else:
            if len(authored) != len(set(authored)):
                self.error("source manifest authored_references contains duplicate paths")
            self.compare_sets('authored references', AUTHORED_REFERENCES, set(authored))
        entries = data.get('sources')
        if not isinstance(entries, list):
            self.error("source manifest sources must be an array")
            return set()
        seen, destinations = set(), set()
        entry_fields = {'source', 'destinations', 'sha256', 'original_bytes', 'original_lines'}
        for index, entry in enumerate(entries, 1):
            label = f"source manifest entry {index}"
            if not isinstance(entry, dict):
                self.error(f"{label}: expected an object")
                continue
            if set(entry) != entry_fields:
                self.error(f"{label}: expected exactly the schema 2 source fields")
            source, targets = entry.get('source'), entry.get('destinations')
            if not isinstance(source, str) or source not in EXPECTED:
                self.error(f"{label}: unexpected source {source!r}")
                continue
            if source in seen:
                self.error(f"{label}: duplicate source {source}")
            seen.add(source)
            expected_targets = list(EXPECTED[source])
            if targets != expected_targets:
                self.error(f"{label}: destinations must be {expected_targets!r}, got {targets!r}")
            if not isinstance(targets, list):
                continue
            target_seen = set()
            for destination in targets:
                if not isinstance(destination, str):
                    self.error(f"{label}: destination must be a path string")
                    continue
                if destination in target_seen:
                    self.error(f"{label}: duplicate destination {destination}")
                target_seen.add(destination)
                destinations.add(destination)
                target = self.inside(self.collection, destination, label)
                if target and not target.is_file():
                    self.error(f"{label}: missing destination {destination}")
            original = self.inside(self.repo, source, label)
            if original is None:
                continue
            try:
                content = original.read_bytes()
            except OSError as exc:
                self.error(f"{source}: cannot read original: {exc}")
                continue
            actual = {
                'sha256': hashlib.sha256(content).hexdigest(),
                'original_bytes': len(content),
                'original_lines': len(content.splitlines()),
            }
            self.source_bytes += actual['original_bytes']
            self.source_lines += actual['original_lines']
            for field, value in actual.items():
                if type(entry.get(field)) is not type(value) or entry.get(field) != value:
                    self.error(f"{source}: source preservation mismatch for {field}: expected {entry.get(field)!r}, got {value!r}")
            if source == f'{SOURCE_ROOT}/SKILL.md' and isinstance(upstream, dict):
                try:
                    metadata, _ = frontmatter(content.decode('utf-8').splitlines())
                except (ValueError, TypeError, UnicodeError) as exc:
                    self.error(f"official master has invalid frontmatter: {exc}")
                    metadata = {}
                if metadata.get('version') != upstream.get('version'):
                    self.error("source manifest upstream version differs from the official master version")
        self.compare_sets('manifest sources', set(EXPECTED), seen)
        source_root = self.repo / SOURCE_ROOT
        actual_sources = set()
        if any(path.is_symlink() for path in (source_root, source_root.parent, source_root.parent.parent)):
            self.error("original source root and its ancestors must not be symlinks")
        for path in source_root.rglob('*'):
            relative = path.relative_to(self.repo).as_posix()
            if path.is_symlink():
                self.error(f"original source inventory: symlink is not allowed: {relative}")
            elif path.is_file():
                actual_sources.add(relative)
            elif path.is_dir():
                if path != source_root / 'references':
                    self.error(f"original source inventory: unexpected directory {relative}")
            else:
                self.error(f"original source inventory: unsupported file type {relative}")
        self.compare_sets('original source inventory', set(EXPECTED), actual_sources)
        references = self.collection / 'references'
        actual_references = {p.relative_to(self.collection).as_posix() for p in references.rglob('*') if p.is_file()}
        expected_references = {target for targets in EXPECTED.values() for target in targets if target != 'SKILL.md'} | AUTHORED_REFERENCES
        self.compare_sets('reference inventory', expected_references, actual_references)
        for destination in AUTHORED_REFERENCES:
            target = self.inside(self.collection, destination, 'authored reference')
            if target and not target.is_file():
                self.error(f"authored reference: missing destination {destination}")
        return (destinations - {'SKILL.md'}) | AUTHORED_REFERENCES

    def compare_sets(self, label, expected, actual):
        for missing in sorted(expected - actual):
            self.error(f"{label}: missing {missing}")
        for extra in sorted(actual - expected):
            self.error(f"{label}: unexpected {extra}")

    def load_documents(self):
        for path in sorted(self.collection.rglob('*.md')):
            label = path.relative_to(self.collection).as_posix()
            if not path.resolve().is_relative_to(self.collection):
                self.error(f"{label}: Markdown symlink escapes collection")
                continue
            try:
                lines = path.read_text(encoding='utf-8').splitlines()
            except (OSError, UnicodeError) as exc:
                self.error(f"{label}: cannot read Markdown: {exc}")
                continue
            self.documents[path.resolve()] = lines
            body = lines
            if label == 'SKILL.md':
                body = self.master(lines)
            elif label.startswith('references/') and lines and lines[0] == '---':
                self.error(f"{label}: reference must not contain YAML frontmatter")
            prose = prose_lines(body, label, self.errors)
            self.anchors[path.resolve()] = heading_ids(prose)
            # README may describe historical source provenance, not loading routes.
            # Runtime API examples in fenced and inline code are excluded.
            if path.name.lower() != 'readme.md':
                for number, line in enumerate(prose, len(lines) - len(body) + 1):
                    if original_loading_instruction(line):
                        self.error(f"{label}:{number}: stale original installed-skill link or loading instruction")

    def master(self, lines):
        if len(lines) >= 500:
            self.error(f"SKILL.md: must be under 500 lines, got {len(lines)}")
        try:
            metadata, start = frontmatter(lines)
        except (ValueError, TypeError) as exc:
            self.error(f"SKILL.md: invalid frontmatter: {exc}")
            return lines
        name = metadata.get('name')
        if not isinstance(name, str) or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", name) or len(name) > 64:
            self.error("SKILL.md: name must be 1–64 lowercase alphanumeric/hyphen characters, without edge or consecutive hyphens")
        elif name != self.collection.name:
            self.error(f"SKILL.md: name {name!r} must match directory {self.collection.name!r}")
        for field, limit, required in (('description', 1024, True), ('compatibility', 500, False)):
            if required or field in metadata:
                value = metadata.get(field)
                if not isinstance(value, str) or not value.strip() or len(value) > limit:
                    self.error(f"SKILL.md: {field} must be a nonempty string of at most {limit} characters")
        for field in ('license', 'allowed-tools'):
            if field in metadata and not isinstance(metadata[field], str):
                self.error(f"SKILL.md: {field} must be a string")
        if 'metadata' in metadata:
            value = metadata['metadata']
            if not isinstance(value, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in value.items()):
                self.error("SKILL.md: metadata must map string keys to string values")
        return [''] * start + lines[start:]

    def check_links(self, destinations):
        direct = set()
        for path, lines in self.documents.items():
            label = path.relative_to(self.collection).as_posix()
            prose = prose_lines(lines, label, [])
            if label == 'SKILL.md' and lines and lines[0] == '---':
                try:
                    end = lines.index('---', 1)
                    prose[:end + 1] = [''] * (end + 1)
                except ValueError:
                    pass
            for target, number in markdown_links(prose, label, self.errors):
                self.link_count += 1
                context = f"{label}:{number}: link {target!r}"
                try:
                    parts = urlsplit(html.unescape(target))
                except ValueError as exc:
                    self.error(f"{context}: malformed URL: {exc}")
                    continue
                if parts.scheme or parts.netloc:
                    if parts.scheme.lower() == 'skill' and re.fullmatch(OLD_NAMES, parts.netloc, re.I):
                        self.error(f"{context}: stale original installed-skill link")
                    continue
                if OLD_PATH.search(unquote(parts.path)):
                    self.error(f"{context}: stale original installed-skill link")
                    continue
                relative = unquote(parts.path)
                resolved = self.inside(self.collection, relative, context) if relative else path
                if resolved is None:
                    continue
                if not resolved.is_file():
                    self.error(f"{context}: local target does not exist or is not a file")
                    continue
                if parts.fragment:
                    fragment = unquote(parts.fragment)
                    if fragment not in self.anchors.get(resolved, set()):
                        self.error(f"{context}: unresolved fragment {fragment!r}")
                        continue
                if label == 'SKILL.md':
                    direct.add(resolved.relative_to(self.collection).as_posix())
        for destination in sorted(destinations - direct):
            self.error(f"SKILL.md: manifest destination is not directly linked: {destination}")
        return direct

    def run(self):
        if not self.collection.is_dir():
            self.error(f"collection directory does not exist: {self.collection}")
            return 1
        skills = {p.relative_to(self.collection).as_posix() for p in self.collection.rglob('SKILL.md') if p.is_file()}
        self.compare_sets('collection entrypoints', {'SKILL.md'}, skills)
        destinations = self.manifest()
        self.load_documents()
        direct = self.check_links(destinations)
        if self.errors:
            for error in self.errors:
                print(f"ERROR: {error}", file=sys.stderr)
            print(f"Structural validation failed: {len(self.errors)} error(s); {len(self.documents)} Markdown files, {self.link_count} links checked.", file=sys.stderr)
            return 1
        master_lines = len(self.documents.get(self.collection / 'SKILL.md', []))
        print(f"Structural validation passed: {len(EXPECTED)} preserved sources, {len(destinations)} references, {len(destinations & direct)} directly linked references, {len(self.documents)} Markdown files, {self.link_count} links, {master_lines} master lines.")
        print(f"Original inventory: {self.source_bytes} bytes, {self.source_lines} lines (bytes.splitlines counts).")
        print("Semantic coverage is not tested; it requires the separate orchestrator judge_batch audit.")
        return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--repo', type=Path, default=Path(__file__).resolve().parent.parent, help='repository containing immutable .agents source skills')
    parser.add_argument('--collection', type=Path, default=Path('skills/ax-skills'), help='collection path, relative to --repo unless absolute')
    args = parser.parse_args()
    collection = args.collection if args.collection.is_absolute() else args.repo / args.collection
    try:
        return Validator(args.repo, collection).run()
    except (OSError, UnicodeError, ValueError, RuntimeError) as exc:
        print(f"ERROR: cannot complete structural validation: {exc}", file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
