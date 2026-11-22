import assert from 'node:assert/strict';
import {
  AxAIAnthropicModel,
  AxAIOpenAIModel,
  type AxChatRequest,
  type AxChatResponse,
  type AxChatResponseTextBlock,
  type AxDocumentInput,
  type AxDocumentSource,
  AxProviderRouter,
  ai,
  ax,
  f,
} from '@ax-llm/ax';
import { type Example, options } from './support.ts';

// Only provider I/O is scripted. Ax owns validation, request mapping, parsing,
// citation normalization, snapshot folding, generation logs, and routing.
type Wire = Record<string, unknown>;
const pdf = Buffer.from('%PDF-1.4\n%%EOF\n').toString('base64');
const document: AxDocumentInput = {
  source: { type: 'text', data: 'Returns are accepted within 30 days.' },
  title: 'Returns policy',
  context: 'Owned example evidence',
  citations: { enabled: true },
};
const charCitation = {
  type: 'char_location',
  document_index: 0,
  document_title: 'Returns policy',
  cited_text: 'within 30 days',
  start_char_index: 21,
  end_char_index: 35,
};
const pageCitation = {
  type: 'page_location',
  document_index: 1,
  document_title: 'PDF policy',
  cited_text: 'PDF passage',
  start_page_number: 1,
  end_page_number: 2,
};
const blockCitation = {
  type: 'content_block_location',
  document_index: 4,
  document_title: 'Block policy',
  cited_text: 'Second block',
  start_block_index: 1,
  end_block_index: 2,
};
const urlCitation = {
  type: 'web_search_result_location',
  url: 'https://example.test/policy',
  title: 'Public policy',
  cited_text: 'Public passage',
};
const content = [
  { type: 'text', text: 'Answer: ' },
  { type: 'text', text: 'Thirty days. ', citations: [charCitation] },
  {
    type: 'text',
    text: 'Keep the receipt.',
    citations: [{ ...charCitation, start_char_index: 0, end_char_index: 7, cited_text: 'Returns' }],
  },
];
function completed(value: AxChatResponse | ReadableStream<AxChatResponse>): AxChatResponse {
  assert(!(value instanceof ReadableStream));
  return value;
}
function requestBody(init?: RequestInit): Wire {
  assert.equal(typeof init?.body, 'string');
  return JSON.parse(String(init?.body)) as Wire;
}
function response(blocks: readonly unknown[] = content): Response {
  return Response.json({
    id: 'owned-citations',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    content: blocks,
    stop_reason: 'end_turn',
    usage: { input_tokens: 20, output_tokens: 8 },
  });
}
function events(): unknown[] {
  return [
    {
      type: 'message_start',
      message: {
        id: 'owned-citations-stream',
        type: 'message',
        role: 'assistant',
        content: [],
        usage: { input_tokens: 20, output_tokens: 0 },
      },
    },
    ...content.flatMap((block, index) => [
      // Exercise citations delivered at block start as well as later citation-only deltas.
      {
        type: 'content_block_start',
        index,
        content_block: {
          type: 'text',
          text: '',
          ...(index === 1 ? { citations: block.citations } : {}),
        },
      },
      {
        type: 'content_block_delta',
        index,
        delta: { type: 'text_delta', text: block.text.slice(0, 3) },
      },
      {
        type: 'content_block_delta',
        index,
        delta: { type: 'text_delta', text: block.text.slice(3) },
      },
      ...(index === 1
        ? []
        : (block.citations ?? []).map((citation) => ({
            type: 'content_block_delta',
            index,
            delta: { type: 'citations_delta', citation },
          }))),
      { type: 'content_block_stop', index },
    ]),
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 8 } },
    { type: 'message_stop' },
  ];
}
function streamResponse(): Response {
  // A finite in-memory SSE body cannot open a network connection or retain a timer.
  return new Response(
    events()
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join(''),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}
const chatPrompt: AxChatRequest['chatPrompt'] = [
  {
    role: 'user',
    content: [
      { type: 'document', ...document },
      { type: 'text', text: 'Answer from and cite the policy.' },
    ],
  },
];

export const examples: readonly Example[] = [
  {
    id: '37-document-citations/native-sources-nonstream',
    title: 'Send every native document source and retain URL-less citation ranges',
    features: [
      'AxDocumentSource',
      'legacy PDF',
      'source normalization',
      'document and URL citations',
    ],
    modes: ['offline'],
    async run(ctx) {
      const sources: AxDocumentSource[] = [
        document.source,
        { type: 'base64', mediaType: 'application/pdf', data: pdf },
        { type: 'url', url: 'https://example.test/policy.pdf' },
        { type: 'file', fileId: 'file_owned_policy' },
        {
          type: 'content',
          content: [
            { type: 'text', text: 'First block' },
            { type: 'text', text: 'Second block' },
          ],
        },
      ];
      let calls = 0;
      let sent: Wire | undefined;
      const service = ai({
        name: 'anthropic',
        apiKey: 'fixture-only',
        config: { model: AxAIAnthropicModel.Claude55Haiku },
        options: {
          retry: { maxRetries: 0 },
          fetch: async (_url, init) => {
            assert.equal(++calls, 1);
            sent = requestBody(init);
            return response([
              {
                type: 'text',
                text: 'Evidence-backed answer.',
                citations: [charCitation, pageCitation, blockCitation, urlCitation],
              },
            ]);
          },
        },
      });
      const result = completed(
        await service.chat(
          {
            chatPrompt: [
              {
                role: 'user',
                content: [
                  ...sources.map((source) => ({
                    type: 'document' as const,
                    ...document,
                    source,
                    cache: true,
                  })),
                  {
                    type: 'file',
                    mimeType: 'application/pdf',
                    data: pdf,
                    title: 'Inline legacy PDF',
                    context: 'PDF context',
                    citations: { enabled: true },
                  },
                  {
                    type: 'file',
                    mimeType: 'application/pdf',
                    fileUri: 'https://example.test/legacy.pdf',
                    citations: { enabled: true },
                  },
                ],
              },
            ],
          },
          { stream: false, abortSignal: ctx.signal },
        ),
      );
      assert(sent);
      const messages = sent.messages as { content: Wire[] }[];
      const parts = messages[0]?.content;
      assert(parts);
      assert.equal(parts.length, 7);
      assert.deepEqual(
        parts.slice(0, 5).map((part) => part.source),
        [
          {
            type: 'text',
            media_type: 'text/plain',
            data: (document.source as Extract<AxDocumentSource, { type: 'text' }>).data,
          },
          { type: 'base64', media_type: 'application/pdf', data: pdf },
          { type: 'url', url: 'https://example.test/policy.pdf' },
          { type: 'file', file_id: 'file_owned_policy' },
          sources[4],
        ],
      );
      for (const part of parts.slice(0, 5)) {
        assert.equal(part.type, 'document');
        assert.equal(part.title, document.title);
        assert.equal(part.context, document.context);
        assert.deepEqual(part.citations, { enabled: true });
        assert.deepEqual(part.cache_control, { type: 'ephemeral' });
      }
      assert.deepEqual(parts[5]?.source, {
        type: 'base64',
        media_type: 'application/pdf',
        data: pdf,
      });
      assert.equal(parts[5]?.context, 'PDF context');
      assert.deepEqual(parts[6]?.source, { type: 'url', url: 'https://example.test/legacy.pdf' });
      const citations = result.results[0]?.citations;
      assert(citations);
      assert.equal(citations.length, 4);
      assert.deepEqual(citations[0], {
        type: 'char_location',
        documentIndex: 0,
        documentTitle: 'Returns policy',
        snippet: 'within 30 days',
        startCharIndex: 21,
        endCharIndex: 35,
      });
      assert.deepEqual(citations[1], {
        type: 'page_location',
        documentIndex: 1,
        documentTitle: 'PDF policy',
        snippet: 'PDF passage',
        startPageNumber: 1,
        endPageNumber: 2,
      });
      assert.deepEqual(citations[2], {
        type: 'content_block_location',
        documentIndex: 4,
        documentTitle: 'Block policy',
        snippet: 'Second block',
        startBlockIndex: 1,
        endBlockIndex: 2,
      });
      assert.deepEqual(citations[3], {
        url: 'https://example.test/policy',
        title: 'Public policy',
        snippet: 'Public passage',
      });
      assert(citations.slice(0, 3).every((citation) => citation.url === undefined));
      assert.deepEqual(result.results[0]?.textBlocks?.[0]?.citations, citations);
      return {
        sources: sources.map((source) => source.type),
        legacyPDFs: 2,
        citations,
        boundary:
          'Real SDK wire/response mapping. PDF bytes and hosted/uploaded sources are transport fixtures, not decoded or fetched documents or inference evidence.',
      };
    },
  },
  {
    id: '37-document-citations/stream-block-snapshots',
    title: 'Replace block snapshots while appending ordinary content deltas',
    features: ['textBlocks', 'citations_delta', 'content deltas', 'immutable snapshots'],
    modes: ['offline'],
    async run(ctx) {
      let calls = 0;
      const service = ai({
        name: 'anthropic',
        apiKey: 'fixture-only',
        config: { model: AxAIAnthropicModel.Claude55Haiku },
        options: {
          fetch: async () => {
            assert.equal(++calls, 1);
            return streamResponse();
          },
        },
      });
      const stream = await service.chat({ chatPrompt }, { stream: true, abortSignal: ctx.signal });
      assert(stream instanceof ReadableStream);
      const reader = stream.getReader();
      const snapshots = new Map<string, AxChatResponseTextBlock>();
      let early: AxChatResponseTextBlock | undefined;
      let text = '';
      let snapshotTextAppendedIncorrectly = '';
      let drained = false;
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) {
            drained = true;
            break;
          }
          for (const result of next.value.results) {
            text += result.content ?? '';
            for (const block of result.textBlocks ?? []) {
              if (block.index === 2 && block.text === 'Keep the receipt.' && !block.citations)
                early = block;
              snapshots.set(`${result.index}:${block.index}`, block);
              snapshotTextAppendedIncorrectly += block.text;
            }
          }
        }
      } finally {
        if (!drained) await reader.cancel();
        reader.releaseLock();
      }
      assert.equal(text, 'Answer: Thirty days. Keep the receipt.');
      assert.deepEqual(
        [...snapshots.values()].map((block) => block.text),
        content.map((block) => block.text),
      );
      assert.notEqual(
        snapshotTextAppendedIncorrectly,
        text,
        'Appending complete snapshots duplicates passage text',
      );
      assert.equal(snapshots.get('0:1')?.citations?.[0]?.startCharIndex, 21);
      assert.equal(snapshots.get('0:2')?.citations?.[0]?.startCharIndex, 0);
      assert(early, 'Retain a pre-citation snapshot for an immutability assertion');
      assert.equal(early.text, 'Keep the receipt.');
      assert.equal(
        early.citations,
        undefined,
        'A later citation must not mutate an already-delivered block',
      );
      return {
        text,
        blocks: [...snapshots.values()],
        earlierSnapshotUnchanged: true,
        boundary:
          'Finite provider SSE through the actual Anthropic adapter; no live model or attribution-quality claim.',
      };
    },
  },
  {
    id: '37-document-citations/generation-passage-associations',
    title: 'Keep original passages and request-local source indices in both generation modes',
    features: [
      'file signature',
      'f.file',
      'getChatLog textBlocks',
      'getUsage citations',
      'request-local indices',
    ],
    modes: ['offline'],
    async run(ctx) {
      const outcomes = [];
      for (const streaming of [false, true]) {
        let calls = 0;
        const service = ai({
          name: 'anthropic',
          apiKey: 'fixture-only',
          config: { model: AxAIAnthropicModel.Claude55Haiku },
          options: {
            fetch: async (_url, init) => {
              assert(++calls <= 2);
              const sent = requestBody(init);
              assert.equal(Boolean(sent.stream), streaming);
              assert.match(JSON.stringify(sent.messages), /"type":"document"/);
              return streaming ? streamResponse() : response();
            },
          },
        });
        const program = ax(
          f()
            .input('source', f.file())
            .output('answer', f.string('Answer from and cite the supplied policy'))
            .build(),
        );
        const logs = [];
        for (const title of ['Returns policy', 'Another request-local policy']) {
          let answer = '';
          const input = { source: { ...document, title } };
          if (streaming) {
            let version = -1;
            for await (const chunk of program.streamingForward(service, input, options(ctx))) {
              if (version !== chunk.version) {
                version = chunk.version;
                answer = '';
              }
              answer += chunk.delta.answer ?? '';
            }
          } else
            answer = (await program.forward(service, input, { ...options(ctx), stream: false }))
              .answer;
          assert.equal(answer, 'Thirty days. Keep the receipt.');
          const log = program.getChatLog();
          assert.equal(log.length, 1, 'The next forward resets round-trip logs');
          const blocks = log[0]?.textBlocks;
          assert(blocks);
          assert.deepEqual(
            blocks.map((block) => [block.index, block.resultIndex, block.text]),
            content.map((block, index) => [index, 0, block.text]),
          );
          assert.equal(
            blocks[0]?.citations,
            undefined,
            'A field label is not itself a cited passage',
          );
          assert.equal(blocks[1]?.citations?.[0]?.startCharIndex, 21);
          assert.equal(blocks[2]?.citations?.[0]?.startCharIndex, 0);
          assert.deepEqual(
            program.getUsage()[0]?.citations?.map((citation) => citation.startCharIndex),
            logs.length === 0 ? [21, 0] : [21, 0, 21, 0],
            'Identical request-local document locations from distinct calls must not collapse globally',
          );
          logs.push({ requestDocumentTitle: title, blocks });
        }
        assert.equal(logs[0]?.blocks[1]?.citations?.[0]?.documentIndex, 0);
        assert.equal(logs[1]?.blocks[1]?.citations?.[0]?.documentIndex, 0);
        // The transport's second answer deliberately repeats an old provider title.
        // Ax retains it, not an inferred global identity: hosts own document binding.
        assert.equal(logs[1]?.blocks[1]?.citations?.[0]?.documentTitle, 'Returns policy');
        outcomes.push({ streaming, calls, logs });
      }
      return {
        outcomes,
        boundary:
          'Logs associate provider passages with locations; they do not verify that a citation matches supplied evidence. Preserve each request document order; index 0 is not a global ID.',
      };
    },
  },
  {
    id: '37-document-citations/local-validation',
    title:
      'Reject mixed document controls, structured JSON, malformed sources, and unsupported deployments before I/O',
    features: [
      'request-wide all-or-none citations',
      'history validation',
      'native JSON rejection',
      'source validation',
      'Vertex Files API boundary',
    ],
    modes: ['offline'],
    async run(ctx) {
      let calls = 0;
      const noTransport: typeof fetch = async () => {
        calls++;
        assert.fail('Invalid input must fail before transport');
      };
      const service = ai({
        name: 'anthropic',
        apiKey: 'fixture-only',
        config: { model: AxAIAnthropicModel.Claude55Haiku },
        options: { fetch: noTransport, retry: { maxRetries: 0 } },
      });
      const cited = { type: 'document' as const, ...document };
      const plain = { ...cited, citations: { enabled: false } };
      const invalidPrompts: AxChatRequest['chatPrompt'][] = [
        [{ role: 'user', content: [cited, plain] }],
        [
          { role: 'user', content: [plain] },
          { role: 'assistant', content: 'Earlier turn' },
          { role: 'user', content: [cited] },
        ],
        [
          {
            role: 'user',
            content: [cited, { type: 'file', mimeType: 'application/pdf', data: pdf }],
          },
        ],
      ];
      for (const invalid of invalidPrompts)
        await assert.rejects(
          () => service.chat({ chatPrompt: invalid }, { stream: false, abortSignal: ctx.signal }),
          /all documents/i,
        );
      const invalidSources: AxDocumentSource[] = [
        { type: 'text', data: '' },
        { type: 'base64', mediaType: 'application/pdf', data: ' ' },
        { type: 'url', url: 'file:///private' },
        { type: 'file', fileId: '' },
        { type: 'content', content: [] },
        { type: 'content', content: [{ type: 'text', text: '' }] },
      ];
      for (const source of invalidSources)
        await assert.rejects(
          () =>
            service.chat(
              { chatPrompt: [{ role: 'user', content: [{ ...cited, source }] }] },
              { stream: false, abortSignal: ctx.signal },
            ),
          /Document/i,
        );
      // Deliberately malformed values model untyped input crossing the public SDK boundary.
      for (const invalid of [
        { ...document, title: 123 },
        { ...document, context: false },
        { ...document, citations: { enabled: 'yes' } },
        { ...document, source: { type: 'base64', mediaType: 'image/png', data: pdf } },
      ])
        await assert.rejects(
          () =>
            service.chat(
              {
                chatPrompt: [
                  {
                    role: 'user',
                    content: [{ type: 'document', ...(invalid as unknown as AxDocumentInput) }],
                  },
                ],
              },
              { stream: false, abortSignal: ctx.signal },
            ),
          /Document/i,
        );
      await assert.rejects(
        () =>
          service.chat(
            {
              chatPrompt,
              responseFormat: {
                type: 'json_schema',
                schema: {
                  type: 'object',
                  properties: { answer: { type: 'string' } },
                  required: ['answer'],
                },
              },
            },
            { stream: false, abortSignal: ctx.signal },
          ),
        /cannot be combined with native structured outputs/i,
      );
      const structured = ax(
        f().input('source', f.file()).output('answer', f.string()).useStructured().build(),
      );
      await assert.rejects(
        () => structured.forward(service, { source: document }, { ...options(ctx), stream: false }),
        /cannot be combined with native structured outputs/i,
      );
      await assert.rejects(
        () =>
          service.chat(
            {
              chatPrompt: [
                {
                  role: 'user',
                  content: [
                    {
                      type: 'file',
                      mimeType: 'text/plain',
                      data: 'plain',
                      citations: { enabled: true },
                    },
                  ],
                },
              ],
            },
            { stream: false, abortSignal: ctx.signal },
          ),
        /require a PDF/i,
      );
      const vertex = ai({
        name: 'anthropic',
        apiKey: async () => 'fixture-access-token',
        projectId: 'fixture-project',
        region: 'global',
        config: { model: AxAIAnthropicModel.Claude55Haiku },
        options: { fetch: noTransport },
      });
      await assert.rejects(
        () =>
          vertex.chat(
            {
              chatPrompt: [
                {
                  role: 'user',
                  content: [{ ...cited, source: { type: 'file', fileId: 'file_owned_policy' } }],
                },
              ],
            },
            { stream: false, abortSignal: ctx.signal },
          ),
        /first-party Files API/i,
      );
      const openai = ai({
        name: 'openai',
        apiKey: 'fixture-only',
        config: { model: AxAIOpenAIModel.GPT4OMini },
        options: { fetch: noTransport },
      });
      await assert.rejects(
        () => openai.chat({ chatPrompt }, { stream: false, abortSignal: ctx.signal }),
        /does not support native document inputs and citations/i,
      );
      assert.equal(calls, 0);
      let uncitedCalls = 0;
      const uncited = ai({
        name: 'anthropic',
        apiKey: 'fixture-only',
        config: { model: AxAIAnthropicModel.Claude55Haiku },
        options: {
          fetch: async (_url, init) => {
            assert(++uncitedCalls <= 2);
            assert.doesNotMatch(JSON.stringify(requestBody(init).messages), /"enabled":true/);
            return response([{ type: 'text', text: 'Uncited answer.' }]);
          },
        },
      });
      for (const citations of [undefined, { enabled: false }]) {
        const part = {
          type: 'document' as const,
          source: document.source,
          title: document.title,
          context: document.context,
          ...(citations ? { citations } : {}),
        };
        const result = completed(
          await uncited.chat(
            {
              chatPrompt: [
                { role: 'user', content: [part] },
                { role: 'user', content: [part] },
              ],
            },
            { stream: false, abortSignal: ctx.signal },
          ),
        );
        assert.equal(result.results[0]?.content, 'Uncited answer.');
        assert.equal(result.results[0]?.citations, undefined);
      }
      assert.equal(uncitedCalls, 2, 'All-disabled and all-omitted document controls remain valid');
      return {
        rejectedHistoryCombinations: invalidPrompts.length,
        malformedSources: invalidSources.length,
        calls,
        uncitedCalls,
        boundary:
          'SDK-owned local validation, not provider errors or document semantic validation.',
      };
    },
  },
  {
    id: '37-document-citations/router-preservation',
    title: 'Exclude incompatible providers despite degradation and preserve native evidence',
    features: [
      'AxProviderRouter',
      'native documents',
      'cited PDF',
      'degradation cannot remove citations',
    ],
    modes: ['offline'],
    async run(ctx) {
      let incompatibleCalls = 0;
      let nativeCalls = 0;
      const openai = ai({
        name: 'openai',
        apiKey: 'fixture-only',
        config: { model: AxAIOpenAIModel.GPT4OMini },
        options: {
          fetch: async () => {
            incompatibleCalls++;
            assert.fail('Routing must exclude incompatible provider');
          },
        },
      });
      const native = ai({
        name: 'anthropic',
        apiKey: 'fixture-only',
        config: { model: AxAIAnthropicModel.Claude55Haiku },
        options: {
          fetch: async (_url, init) => {
            assert(++nativeCalls <= 2);
            const sent = requestBody(init);
            assert.match(JSON.stringify(sent.messages), /"type":"document"/);
            assert.match(JSON.stringify(sent.messages), /"citations":\{"enabled":true\}/);
            assert.doesNotMatch(JSON.stringify(sent.messages), /degraded fixture text/);
            return response();
          },
        },
      });
      const router = new AxProviderRouter({
        providers: { primary: openai, alternatives: [native] },
        routing: {
          preferenceOrder: ['capability'],
          capability: { requireExactMatch: false, allowDegradation: true },
        },
        processing: {},
      });
      for (const request of [
        { chatPrompt },
        {
          chatPrompt: [
            {
              role: 'user' as const,
              content: [
                {
                  type: 'file' as const,
                  mimeType: 'application/pdf',
                  data: pdf,
                  extractedText: 'degraded fixture text',
                  citations: { enabled: true },
                },
              ],
            },
          ],
        },
      ]) {
        const { response: routed } = await router.chat(request, {
          stream: false,
          abortSignal: ctx.signal,
        });
        const result = completed(routed);
        assert.equal(result.results[0]?.textBlocks?.[1]?.citations?.[0]?.documentIndex, 0);
      }
      assert.equal(incompatibleCalls, 0);
      assert.equal(nativeCalls, 2);
      return {
        incompatibleCalls,
        nativeCalls,
        boundary:
          'Actual capability routing and source preservation with injected I/O, not cross-provider quality equivalence.',
      };
    },
  },
];
