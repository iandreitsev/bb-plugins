// bb-plugin-codex-sidebar — backend.
//
// Keeps the "Priority" set: threads that started working since the user last
// cleared them. bb has no notion of "cleared", so the plugin records it.
// The set lives in bb.storage.kv as { [threadId]: addedAtEpochMs } and every
// change is broadcast on PRIORITY_CHANGED so open sidebars refetch.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { LIST_ID, MAX_PRIORITY_ENTRIES, PRIORITY_CHANGED, TOGGLE_VIEW_PATH } from "./shared";

const prioritySchema = z.record(z.string(), z.number());
export type PriorityMap = z.infer<typeof prioritySchema>;

const threadIdsSchema = z.object({
  threadIds: z.array(z.string().min(1).max(200)).max(1000),
});

export const rpcContract = defineRpcContract({
  priority_list: {
    input: z.null(),
    output: z.object({ priority: prioritySchema }),
  },
  priority_add: {
    input: threadIdsSchema,
    output: z.object({ priority: prioritySchema }),
  },
  priority_remove: {
    input: threadIdsSchema,
    output: z.object({ priority: prioritySchema }),
  },
});

const KEY = "priority";
/**
 * Archived threads keep their entry so bb's archive Undo restores them into
 * Priority; the cap keeps those leftovers from growing the kv value forever.
 */

function capped(priority: PriorityMap): PriorityMap {
  const entries = Object.entries(priority);
  if (entries.length <= MAX_PRIORITY_ENTRIES) return priority;
  entries.sort((a, b) => b[1] - a[1]);
  return Object.fromEntries(entries.slice(0, MAX_PRIORITY_ENTRIES));
}

export default async function plugin(bb: BbPluginApi) {
  // Event handlers and RPC calls can interleave; chain every read-modify-write
  // so concurrent updates never drop each other's changes.
  let queue: Promise<unknown> = Promise.resolve();
  function update(
    mutate: (priority: PriorityMap) => boolean,
  ): Promise<PriorityMap> {
    const next = queue.then(async () => {
      const stored = prioritySchema.safeParse(await bb.storage.kv.get(KEY));
      let priority: PriorityMap = stored.success ? stored.data : {};
      if (mutate(priority)) {
        priority = capped(priority);
        await bb.storage.kv.set(KEY, priority);
        bb.realtime.publish(PRIORITY_CHANGED, null);
      }
      return priority;
    });
    queue = next.catch(() => undefined);
    return next;
  }

  const add = (threadIds: readonly string[]) =>
    update((priority) => {
      let changed = false;
      const now = Date.now();
      for (const id of threadIds) {
        if (priority[id] === undefined) {
          priority[id] = now;
          changed = true;
        }
      }
      return changed;
    });

  const remove = (threadIds: readonly string[]) =>
    update((priority) => {
      let changed = false;
      for (const id of threadIds) {
        if (priority[id] !== undefined) {
          delete priority[id];
          changed = true;
        }
      }
      return changed;
    });

  bb.rpc.register(rpcContract, {
    priority_list: async () => ({ priority: await update(() => false) }),
    priority_add: async ({ threadIds }) => ({ priority: await add(threadIds) }),
    priority_remove: async ({ threadIds }) => ({
      priority: await remove(threadIds),
    }),
  });

  // Recorded server-side so a thread that works while the sidebar is closed
  // still lands in Priority. Child threads are recorded too: the sidebar
  // puts a parent in Priority when any thread of its subtree is there.
  // Hidden helper threads never show in the list, so they are skipped.
  function track(
    thread: { id: string; visibility?: string },
    change: (threadIds: readonly string[]) => Promise<PriorityMap>,
  ): Promise<void> {
    if ((thread.visibility ?? "visible") !== "visible") return Promise.resolve();
    return change([thread.id]).then(
      () => undefined,
      (error: unknown) => bb.log.warn(`priority update failed: ${String(error)}`),
    );
  }
  bb.events.on("thread.active", ({ thread }) => track(thread, add));
  // A thread that fails before reaching active is an unread error: it
  // belongs in Priority too.
  bb.events.on("thread.failed", ({ thread }) => track(thread, add));
  bb.events.on("thread.deleted", ({ thread }) => track(thread, remove));

  // The sidebar shows one thread list at a time, chosen by the server-synced
  // UI preference below. "__automatic__" picks the first non-bundled list,
  // which is this plugin's, so only an explicit bb choice means bb's list.
  const OWN_LIST = `${bb.pluginId}/${LIST_ID}`;
  const BB_LIST = "thread-list/thread-list";
  const PROVIDER_KEY = "sidebar.threadListProvider";
  async function toggleView(): Promise<"projects" | "priority"> {
    const { preferences } = await bb.sdk.system.uiPreferences.list();
    const entry = preferences[PROVIDER_KEY];
    const showingOwn = entry.value === OWN_LIST || entry.value === "__automatic__";
    await bb.sdk.system.uiPreferences.set({
      key: PROVIDER_KEY,
      expectedRevision: entry.revision,
      value: showingOwn ? BB_LIST : OWN_LIST,
    });
    return showingOwn ? "projects" : "priority";
  }
  bb.http.route("POST", TOGGLE_VIEW_PATH, async (context) => {
    // A second window may change the preference between list and set; the
    // set then fails on the stale revision, so re-read and try once more.
    try {
      return context.json({ view: await toggleView() });
    } catch {
      return context.json({ view: await toggleView() });
    }
  });
}
