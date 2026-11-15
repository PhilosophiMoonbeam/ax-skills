import assert from 'node:assert/strict';
import {
  ax, AxMCPClient, AxMCPEventSource, AxProgram,
  AxInMemoryEventStore, AxInMemoryProgramStateStore,
  axMCPEventRoutes, eventInput, eventPath, eventRoute, eventRuntime, eventTarget,
  type AxAIService, type AxEventIngress, type AxGenStreamingOut,
  type AxMCPEventSourceIdentity, type AxMCPJSONRPCRequest, type AxMCPJSONRPCResponse,
  type AxMCPListeningHandle, type AxMCPListeningOptions, type AxMCPRequestOptions,
  type AxMCPResource, type AxMCPTask, type AxMCPTransportLifecycleState,
  type AxProgrammable, type AxProgramForwardOptions, type AxProgramStreamingForwardOptions,
} from '@ax-llm/ax';
import { LocalMCPPeer, object } from './19-mcp.js';
import { options, scriptedAI, type Example } from './support.js';

const resource = (name: string, selected = true): AxMCPResource => ({
  name, uri: `inventory://${name}`, mimeType: selected ? 'text/markdown' : 'text/plain',
});

// Application-owned JSON-RPC I/O only. Ax owns catalogs, logical owners,
// normalization, routing, state and continuations. This fixture authenticates nobody.
class ManagedMCPPeer extends LocalMCPPeer {
  resources: AxMCPResource[] = [resource('a'), resource('shared'), resource('ignored', false)];
  failNextSubscription?: string;
  listenerStarts = 0;
  listenerCloses = 0;
  reconnects = 0;
  private readonly listenerClosers = new Set<() => void>();
  private lifecycleHandler?: (state: AxMCPTransportLifecycleState) => void | Promise<void>;

  constructor() {
    super();
    this.intercept = request => request.method === 'resources/list'
      ? { resources: structuredClone(this.resources) } : undefined;
  }
  setLifecycleHandler(handler: NonNullable<ManagedMCPPeer['lifecycleHandler']>): void {
    this.lifecycleHandler = handler;
  }
  async reconnect(): Promise<void> {
    assert(!this.closed);
    assert(this.lifecycleHandler, 'The real client must install transport recovery');
    this.subscriptions.clear(); // Simulate remote subscription loss, not client intent loss.
    this.reconnects++;
    await this.lifecycleHandler('reconnected');
  }
  async send(request: Readonly<AxMCPJSONRPCRequest>, opts?: Readonly<AxMCPRequestOptions>): Promise<AxMCPJSONRPCResponse> {
    assert(!this.closed);
    opts?.signal?.throwIfAborted();
    if (request.method === 'resources/subscribe' && object(request.params).uri === this.failNextSubscription) {
      const uri = this.failNextSubscription;
      this.failNextSubscription = undefined;
      this.requests.push(structuredClone(request));
      return { jsonrpc: '2.0', id: request.id, error: { code: -32000, message: `Injected subscription rejection: ${uri}` } };
    }
    return super.send(request, opts);
  }
  startListening(opts: Readonly<AxMCPListeningOptions> = {}): AxMCPListeningHandle {
    assert(!this.closed);
    opts.signal?.throwIfAborted();
    const stopped = Promise.withResolvers<void>();
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      opts.signal?.removeEventListener('abort', close);
      this.listenerClosers.delete(close);
      this.listenerCloses++;
      stopped.resolve();
    };
    this.listenerClosers.add(close);
    opts.signal?.addEventListener('abort', close, { once: true });
    this.listenerStarts++;
    return { ready: Promise.resolve(), done: stopped.promise, close };
  }
  get activeListeners(): number { return this.listenerClosers.size; }
  close(): void {
    for (const close of [...this.listenerClosers]) close();
    super.close();
  }
}

function subscriptionRequests(peer: ManagedMCPPeer, from = 0): string[] {
  return peer.requests.slice(from)
    .filter(request => ['resources/subscribe', 'resources/unsubscribe'].includes(request.method))
    .map(request => `${request.method} ${String(object(request.params).uri)}`);
}

function assertSubscriptions(client: AxMCPClient, peer: ManagedMCPPeer, expected: string[]): void {
  assert.deepEqual(client.getResourceSubscriptions(), [...expected].sort());
  assert.deepEqual([...peer.subscriptions].sort(), [...expected].sort());
}

type TaskInput = { namespace: string; taskId: string; phase: string; status?: string };
type TaskOutput = { taskOutcome: string };

export const examples: readonly Example[] = [
  {
    id: '38-mcp-events/managed-subscriptions',
    title: 'Manage concrete resource intent across selection errors, partial failure and reconnect',
    features: ['AxMCPEventSource', 'axMCPEventRoutes', 'selector', 'logical owners', 'reconnect', 'onSourceError', 'no implicit wake'],
    modes: ['offline'],
    async run(ctx) {
      const peer = new ManagedMCPPeer();
      const client = new AxMCPClient(peer, { namespace: 'managed', era: 'legacy' });
      const errors: { sourceId: string; error: unknown }[] = [];
      const invalidated: string[] = [];
      const observed: string[] = [];
      const clientEvents: string[] = [];
      const selectedURIs: string[] = [];
      let selectorThrows = false;
      let modelCalls = 0;
      const selectorError = new Error('Application selector failed');
      const model = scriptedAI(() => { modelCalls++; throw new Error('Notifications must not call the model'); });
      const reportError = (sourceId: string, error: unknown) => { errors.push({ sourceId, error }); };
      // These labels stand in for verified host state. They do not test authentication.
      const principal = { identity: { tenantId: 'fixture-owner' }, trust: 'authenticated' as const };
      const omitted = eventRuntime({ allowVolatile: true, onSourceError: reportError,
        sources: [new AxMCPEventSource({ id: 'managed-none', client, ...principal })],
        routes: axMCPEventRoutes({ client }),
      });
      const selected = eventRuntime({ allowVolatile: true, workerConcurrency: 1, onSourceError: reportError,
        sources: [new AxMCPEventSource({ id: 'managed-selected', client, ...principal,
          resourceSubscriptions: { select: (item, catalog) => {
            assert.equal(catalog.namespace, 'managed');
            assert(catalog.resources.some(candidate => candidate.uri === item.uri));
            selectedURIs.push(item.uri);
            if (selectorThrows) throw selectorError;
            return item.mimeType === 'text/markdown';
          } },
        })],
        routes: [
          ...axMCPEventRoutes({ client,
            onCatalogInvalidated: catalog => { invalidated.push(catalog); },
            onObserve: ingress => { observed.push(ingress.event.type); },
          }),
          // A configured model target still needs an explicit application wake event.
          eventRoute('explicit-review').types('host.review.requested').authenticated().wake(
            eventTarget('resource-review').program(ax('uri:string -> review:string')).ai(model)
              .input(eventInput<{ uri: string }>().field('uri', eventPath.data('uri')))
              .forwardOptions(options(ctx)).build(),
          ).build(),
        ],
      });
      const shared = eventRuntime({ allowVolatile: true, onSourceError: reportError,
        sources: [new AxMCPEventSource({ id: 'managed-shared', client, ...principal,
          resourceSubscriptions: ['inventory://shared'],
        })], routes: axMCPEventRoutes({ client }),
      });
      const stopObserving = client.subscribeEvents(event => { clientEvents.push(event.type); });
      try {
        await omitted.start();
        const catalog = await client.inspectCatalog();
        assert.equal(catalog.resourceTemplates[0]?.uriTemplate, 'inventory://item/{sku}');
        assertSubscriptions(client, peer, []);
        assert.deepEqual(subscriptionRequests(peer), [], 'Omitted policy is none, even with a catalog and templates');
        await omitted.close();
        assert.equal(peer.activeListeners, 0);

        await client.subscribeResource('inventory://shared');
        await selected.start();
        await shared.start();
        assertSubscriptions(client, peer, ['inventory://a', 'inventory://shared']);
        assert.deepEqual(subscriptionRequests(peer), [
          'resources/subscribe inventory://shared', 'resources/subscribe inventory://a',
        ], 'Manual plus two source owners send only the first wire subscribe');
        assert.equal(peer.activeListeners, 2);

        selectorThrows = true;
        peer.resources = [resource('b'), resource('c'), resource('shared'), resource('ignored', false)];
        let before = peer.requests.length;
        await peer.emit('notifications/resources/list_changed', {});
        await selected.waitForIdle();
        assert.deepEqual(subscriptionRequests(peer, before), []);
        assertSubscriptions(client, peer, ['inventory://a', 'inventory://shared']);
        assert.equal(errors.length, 1);
        assert.equal(errors[0]?.sourceId, 'managed-selected');
        assert.equal(errors[0]?.error, selectorError, 'onSourceError exposes the selector failure');

        selectorThrows = false;
        peer.failNextSubscription = 'inventory://c';
        before = peer.requests.length;
        await peer.emit('notifications/resources/list_changed', {});
        await selected.waitForIdle();
        assert.deepEqual(subscriptionRequests(peer, before), [
          'resources/unsubscribe inventory://a', 'resources/subscribe inventory://b', 'resources/subscribe inventory://c',
        ]);
        assertSubscriptions(client, peer, ['inventory://b', 'inventory://shared']);
        assert.equal(errors.length, 2);
        assert.equal(errors[1]?.sourceId, 'managed-selected');
        assert(errors[1]?.error instanceof AggregateError);
        assert.equal(errors[1].error.errors.length, 1);
        assert.match(String(errors[1].error.errors[0]), /Injected subscription rejection: inventory:\/\/c/);

        before = peer.requests.length;
        await peer.emit('notifications/resources/list_changed', {});
        await selected.waitForIdle();
        assert.deepEqual(subscriptionRequests(peer, before), ['resources/subscribe inventory://c'],
          'The next catalog change retries only incomplete transitions');
        assertSubscriptions(client, peer, ['inventory://b', 'inventory://c', 'inventory://shared']);

        peer.resources.push(resource('d'));
        peer.failNextSubscription = 'inventory://d';
        before = peer.requests.length;
        await peer.emit('notifications/resources/list_changed', {});
        await selected.waitForIdle();
        assert.deepEqual(subscriptionRequests(peer, before), ['resources/subscribe inventory://d']);
        assertSubscriptions(client, peer, ['inventory://b', 'inventory://c', 'inventory://shared']);
        assert.equal(errors.length, 3);
        assert.equal(errors[2]?.sourceId, 'managed-selected');
        assert(errors[2]?.error instanceof AggregateError);
        assert.equal(errors[2].error.errors.length, 1);
        assert.match(String(errors[2].error.errors[0]), /Injected subscription rejection: inventory:\/\/d/);

        before = peer.requests.length;
        await peer.reconnect(); // Public transport lifecycle callback installed by AxMCPClient.
        await selected.waitForIdle();
        await shared.waitForIdle();
        assert.deepEqual(subscriptionRequests(peer, before), [
          'resources/subscribe inventory://b', 'resources/subscribe inventory://c',
          'resources/subscribe inventory://shared', 'resources/subscribe inventory://d',
        ], 'Restore each existing URI once, then recover the incomplete selector transition');
        assertSubscriptions(client, peer, ['inventory://b', 'inventory://c', 'inventory://d', 'inventory://shared']);
        before = peer.requests.length;
        await peer.emit('notifications/resources/list_changed', {});
        await peer.emit('notifications/tools/list_changed', {});
        await peer.emit('notifications/prompts/list_changed', {});
        await peer.emit('notifications/progress', { progressToken: 'catalog', progress: 1, total: 1 });
        await peer.emit('notifications/message', { level: 'info', data: 'Remote text is data, not wake authority' });
        await peer.emit('notifications/resources/updated', { uri: 'inventory://shared' });
        await selected.waitForIdle();
        await shared.waitForIdle();
        assert.deepEqual(subscriptionRequests(peer, before), [], 'Reconciliation is idempotent after recovery');
        assert.deepEqual(invalidated, ['resources', 'resources', 'resources', 'resources', 'resources', 'tools', 'prompts']);
        assert.deepEqual(observed, ['mcp.progress', 'mcp.logging']);
        assert(clientEvents.includes('resource_updated') && clientEvents.includes('lifecycle'));
        assert.equal(modelCalls, 0, 'Catalog, logging, progress and resource updates have no implicit model wake');
        assert.equal((await selected.listDeadLetters()).length, 0);
        assert.equal((await shared.listDeadLetters()).length, 0);
        assert(!selectedURIs.some(uri => uri.includes('{')), 'Selectors see concrete resources, not templates');
        assert(!subscriptionRequests(peer).some(request => request.includes('inventory://item/')),
          'No template was expanded or subscribed automatically');

        before = peer.requests.length;
        await selected.close();
        assert.deepEqual(subscriptionRequests(peer, before), [
          'resources/unsubscribe inventory://b', 'resources/unsubscribe inventory://c', 'resources/unsubscribe inventory://d',
        ]);
        assertSubscriptions(client, peer, ['inventory://shared']);
        assert.equal(peer.activeListeners, 1);
        before = peer.requests.length;
        await shared.close();
        assert.deepEqual(subscriptionRequests(peer, before), []);
        assertSubscriptions(client, peer, ['inventory://shared']);
        assert.equal(peer.activeListeners, 0);
        await client.unsubscribeResource('inventory://shared');
        assertSubscriptions(client, peer, []);
        assert.equal(subscriptionRequests(peer).filter(request => request === 'resources/unsubscribe inventory://shared').length, 1,
          'The final manual release proves reconnect did not create an independent phantom owner');
        assert.equal(errors.length, 3);
        assert.equal(peer.listenerStarts, 3);
        assert.equal(peer.listenerCloses, 3);
        return { omittedPolicy: 'none', sourceErrors: errors.map(item => ({ sourceId: item.sourceId, error: String(item.error) })),
          invalidated, observed, modelCalls, reconnects: peer.reconnects,
          transitions: subscriptionRequests(peer), listeningHandles: { opened: peer.listenerStarts, closed: peer.listenerCloses },
          boundary: 'Real SDK lifecycle over deterministic legacy JSON-RPC I/O; host fixture identity is not authentication. Volatile storage is explicitly allowed, not durable delivery.' };
      } finally {
        stopObserving();
        try { await Promise.all([omitted.close(), selected.close(), shared.close()]); }
        finally { await client.close(); }
        assert(peer.closed && peer.activeListeners === 0);
      }
    },
  },
  {
    id: '38-mcp-events/owned-task-resume',
    title: 'Resume identity-scoped MCP task continuations once with restored program state',
    features: ['AxMCPEventSource', 'axMCPEventRoutes', 'mcp.task', 'createProgram', 'program state', 'identity isolation', 'continuation consumption', 'persisted output'],
    modes: ['offline'],
    async run(ctx) {
      const peer = new ManagedMCPPeer();
      const otherPeer = new ManagedMCPPeer();
      const client = new AxMCPClient(peer, { namespace: 'jobs', era: 'legacy' });
      const otherClient = new AxMCPClient(otherPeer, { namespace: 'other-jobs', era: 'legacy' });
      const namespace = client.getNamespace();
      const otherNamespace = otherClient.getNamespace();
      assert.notEqual(namespace, otherNamespace, 'Task ownership requires distinct canonical namespaces');
      const store = new AxInMemoryEventStore();
      const states = new AxInMemoryProgramStateStore();
      const owner = { tenantId: 'tenant-a', userId: 'owner-a' };
      // Host-controlled fixture principal, never derived from a notification body.
      // A production adapter must verify its credentials before assigning these labels.
      let principal: AxMCPEventSourceIdentity = { identity: owner, trust: 'authenticated' };
      const sourceErrors: unknown[] = [];
      const taskEvents: Readonly<AxEventIngress>[] = [];
      const progressEvents: Readonly<AxEventIngress>[] = [];
      const businessEffects: string[] = [];
      const restoredKeys: string[] = [];
      const runIds: string[] = [];
      const outputs: TaskOutput[] = [];
      let invocations = 0;
      let constructed = 0;
      let modelCalls = 0;
      const model = scriptedAI(() => { modelCalls++; throw new Error('Task notification callbacks must not call a model'); });
      class OwnedTask extends AxProgram<TaskInput, TaskOutput> implements AxProgrammable<TaskInput, TaskOutput> {
        private starts = 0;
        private ownerKey = '';
        constructor() {
          super('namespace:string, taskId:string, phase:string, status?:string -> taskOutcome:string');
          this.setId('owned-mcp-task-v1');
        }
        async forward(_ai: Readonly<AxAIService>, input: TaskInput, opts?: Readonly<AxProgramForwardOptions<string>>): Promise<TaskOutput> {
          assert(opts?.eventContext);
          const context = opts.eventContext;
          invocations++;
          runIds.push(context.runId);
          const key = `${input.namespace}:${input.taskId}`;
          assert.deepEqual(context.identity, owner);
          assert.equal(context.trust, 'authenticated');
          if (input.phase === 'start') {
            this.starts++;
            this.ownerKey = key;
            context.registerContinuation({ correlation: [{ kind: 'mcp.task', value: key }],
              metadata: { namespace: input.namespace, taskId: input.taskId } });
            return { taskOutcome: `Waiting for ${key}` };
          }
          assert.equal(input.phase, 'resume');
          assert(context.continuation);
          assert.deepEqual(context.continuation.correlation, [{ kind: 'mcp.task', value: key }]);
          assert.deepEqual(context.continuation.metadata, { namespace: input.namespace, taskId: input.taskId });
          assert.equal(this.starts, 1, 'A fresh program must restore its own waiting state');
          assert.equal(this.ownerKey, key, 'State must not leak between task instances');
          assert(input.status === 'completed' || input.status === 'input_required');
          restoredKeys.push(this.ownerKey);
          businessEffects.push(`${key}:${input.status}`); // A list, not a Set that could hide repeated effects.
          return { taskOutcome: `Handled ${key}:${input.status}` };
        }
        async *streamingForward(ai: Readonly<AxAIService>, input: TaskInput, opts?: Readonly<AxProgramStreamingForwardOptions<string>>): AxGenStreamingOut<TaskOutput> {
          const output = await this.forward(ai, input, opts);
          yield { index: 0, version: 1, delta: output, partial: output };
        }
        getState() { return { starts: this.starts, ownerKey: this.ownerKey }; }
        setState(state: unknown) {
          const saved = object(state);
          assert.equal(typeof saved.starts, 'number');
          assert.equal(typeof saved.ownerKey, 'string');
          this.starts = Number(saved.starts);
          this.ownerKey = String(saved.ownerKey);
        }
      }
      const target = eventTarget('owned-mcp-task').createProgram(new OwnedTask().getSignature(), () => {
        constructed++;
        return new OwnedTask();
      }).ai(model).forwardOptions(options(ctx))
        .wakeInput(eventInput<TaskInput>().field('namespace', eventPath.data('namespace'))
          .field('taskId', eventPath.data('taskId')).field('phase', eventPath.constant('start')))
        .resumeInput(eventInput<TaskInput>().field('namespace', eventPath.continuation('namespace'))
          .field('taskId', eventPath.continuation('taskId')).field('phase', eventPath.constant('resume'))
          .field('status', eventPath.data('status'))).build();
      const defaults = [client, otherClient].flatMap(attached => axMCPEventRoutes({ client: attached,
        onObserve: ingress => { progressEvents.push(ingress); },
      })).map(route => route.action === 'resume' ? { ...route, requireAuthenticated: true } : route);
      // Default routes supply correlation, not authentication. Add a public host trust gate.
      const runtime = eventRuntime({ allowVolatile: true, store, programStateStore: states,
        workerConcurrency: 1, maxAttempts: 1, onSourceError: (_sourceId, error) => { sourceErrors.push(error); },
        sources: [
          new AxMCPEventSource({ id: 'owned-jobs', client, resolveIdentity: () => principal }),
          new AxMCPEventSource({ id: 'other-jobs', client: otherClient, identity: owner, trust: 'authenticated' }),
        ],
        routes: [...defaults,
          eventRoute('start-owned-task').types('host.task.requested').authenticated()
            .instanceKey(eventPath.subject()).wake(target).build(),
          eventRoute('observe-task-status').types('mcp.task.status').observe(ingress => { taskEvents.push(ingress); }).build(),
        ],
      });
      const notifyTask = async (transport: ManagedMCPPeer, taskId: string, status: AxMCPTask['status']) => {
        const task: AxMCPTask = { taskId, status, createdAt: new Date(0).toISOString(), lastUpdatedAt: new Date(0).toISOString() };
        await transport.emit('notifications/tasks/status', { task });
        // emit awaits the SDK source's publication; idle is the deterministic execution barrier.
        await runtime.waitForIdle();
      };
      try {
        await runtime.start();
        for (const status of ['completed', 'input_required'] as const) {
          const taskId = `job-${status}`;
          const key = `${namespace}:${taskId}`;
          const beforeInvocations = invocations;
          const beforeEffects = businessEffects.length;
          principal = { identity: owner, trust: 'authenticated' };
          const receipt = await runtime.publish({ event: { specversion: '1.0', id: `start-${taskId}`,
            source: 'urn:example:owned-mcp-task', type: 'host.task.requested', subject: key,
            data: { namespace, taskId } }, identity: owner, trust: 'authenticated' }, ctx.signal);
          await runtime.waitForIdle();
          const paused = await store.getDelivery(receipt.deliveryIds[0]!);
          assert.equal(paused?.status, 'waiting_event');
          assert(paused.runId);
          const pausedRun = await runtime.getRun(paused.runId);
          assert.equal(pausedRun?.status, 'waiting_event');
          assert.equal(pausedRun.continuationIds?.length, 1);
          assert.deepEqual(pausedRun.output, { taskOutcome: `Waiting for ${key}` });
          const correlation = { kind: 'mcp.task', value: key };
          const continuation = await store.findContinuation(paused.identityScope, correlation, Date.now());
          assert(continuation);
          assert.equal(continuation.id, pausedRun.continuationIds[0]);
          assert.equal(await store.findContinuation(paused.identityScope, { kind: 'mcp.task', value: taskId }, Date.now()), undefined,
            'A bare task ID is not the namespace-qualified continuation key');

          await notifyTask(peer, taskId, 'working');
          await peer.emit('notifications/progress', { progressToken: taskId, progress: 1, total: 2 });
          await runtime.waitForIdle();
          assert.equal(invocations, beforeInvocations + 1, 'Working and progress observe without resume');
          assert.equal(businessEffects.length, beforeEffects);
          assert.equal(progressEvents.at(-1)?.event.type, 'mcp.progress');
          assert.deepEqual(taskEvents.at(-1)?.correlation, [correlation]);
          assert.equal(taskEvents.at(-1)?.event.subject, key);

          principal = { identity: { tenantId: 'tenant-b', userId: 'owner-b' }, trust: 'authenticated' };
          await notifyTask(peer, taskId, status);
          principal = { identity: {}, trust: 'untrusted' };
          await notifyTask(peer, taskId, status);
          assert.deepEqual(taskEvents.at(-1)?.identity, {});
          assert.equal(taskEvents.at(-1)?.trust, 'untrusted');
          await notifyTask(otherPeer, taskId, status);
          assert.deepEqual(taskEvents.at(-1)?.correlation, [{ kind: 'mcp.task', value: `${otherNamespace}:${taskId}` }]);
          assert.equal(invocations, beforeInvocations + 1, 'Foreign identity, anonymous identity and foreign namespace cannot resume the owner');
          assert.equal(businessEffects.length, beforeEffects);
          assert.equal((await store.findContinuation(paused.identityScope, correlation, Date.now()))?.id, continuation.id);

          principal = { identity: owner, trust: 'authenticated' };
          await notifyTask(peer, taskId, status);
          assert.equal(invocations, beforeInvocations + 2);
          assert.equal(businessEffects.length, beforeEffects + 1);
          const resumed = await runtime.getRun(runIds.at(-1)!);
          assert.equal(resumed?.status, 'succeeded');
          assert.equal(resumed.instanceKey, pausedRun.instanceKey);
          const output = { taskOutcome: `Handled ${key}:${status}` };
          assert.deepEqual(resumed.output, output, 'Inspect stored output, not only callback occurrence');
          outputs.push(output);
          assert.equal(await store.findContinuation(paused.identityScope, correlation, Date.now()), undefined);
          const completedIngress = taskEvents.at(-1)!;
          assert.deepEqual(completedIngress.identity, owner);
          const duplicate = await runtime.publish(completedIngress, ctx.signal);
          assert.equal(duplicate.duplicate, true, 'Replaying the exact normalized envelope is deduplicated');
          await notifyTask(peer, taskId, status);
          assert.notEqual(taskEvents.at(-1)?.event.id, completedIngress.event.id,
            'A repeated protocol notification receives a new normalized envelope');
          assert.equal(invocations, beforeInvocations + 2, 'A new envelope cannot reuse the consumed continuation');
          assert.equal(businessEffects.length, beforeEffects + 1);
        }
        assert.equal(invocations, 4);
        assert.equal(constructed, 4);
        assert.deepEqual(restoredKeys, [`${namespace}:job-completed`, `${namespace}:job-input_required`]);
        assert.deepEqual(businessEffects, [`${namespace}:job-completed:completed`, `${namespace}:job-input_required:input_required`]);
        assert.equal(progressEvents.length, 2);
        assert.equal(taskEvents.filter(ingress => object(ingress.event.data).status === 'working').length, 2);
        const deadLetters = await runtime.listDeadLetters();
        assert.equal(deadLetters.length, 6, 'Two foreign-owner, two wrong-namespace and two consumed-key deliveries fail closed');
        assert(deadLetters.every(letter => /continuation/i.test(letter.reason)));
        assert.equal(modelCalls, 0);
        assert.deepEqual(sourceErrors, []);
        assertSubscriptions(client, peer, []);
        assertSubscriptions(otherClient, otherPeer, []);
        return { namespace, otherNamespace, invocations, freshInstances: constructed, restoredKeys, businessEffects, outputs,
          rejectedResumeDeliveries: deadLetters.length, observedProgress: progressEvents.length, modelCalls,
          boundary: 'Host-supplied fixture identity is not proof of authentication. The SDK enforces the configured trust gate, identity scope, namespace correlation and continuation consumption in volatile storage; this is not crash-safe exactly-once delivery.' };
      } finally {
        try { await runtime.close({ drain: false }); }
        finally { await Promise.all([client.close(), otherClient.close()]); }
        assert(peer.closed && otherPeer.closed);
        assert.equal(peer.activeListeners + otherPeer.activeListeners, 0);
        assert.equal(peer.listenerStarts, peer.listenerCloses);
        assert.equal(otherPeer.listenerStarts, otherPeer.listenerCloses);
      }
    },
  },
];
