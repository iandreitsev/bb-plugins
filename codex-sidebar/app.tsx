// bb-plugin-codex-sidebar — frontend.
//
// Replaces bb's sidebar thread list with a Codex-style Priority list:
//   Pinned (when any), Priority (threads working now, plus threads that
//   worked since the user last cleared them; the set is kept by server.ts),
//   then day groups: Today, Yesterday, weekdays, then months. Each row shows
//   the project name beside the title. Child threads (subagents spawned as bb
//   sub-threads) nest under their parent, and a parent's place follows its
//   whole subtree.
// The ordinary view is bb's own list: the
// persistent header button and the palette command switch between the two.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  experimental_useProviders as useProviders,
  definePluginApp,
  experimental_useSidebarThreads as useSidebarThreads,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  useSdk,
  type PluginSidebarThread,
  type PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import type { PriorityMap, rpcContract } from "./server";
import { LIST_ID, MAX_PRIORITY_ENTRIES, PRIORITY_CHANGED, toggleSidebarView } from "./shared";
import { mountSidebarToggle } from "./sidebar-header";
import { mountNativeProjectLimit } from "./native-project-limit";
import { useRowOrder } from "./row-order";
import { NativeThreadRow } from "./native-row";
import { useShowPinned, useShowPriority, ViewOptions } from "./view-options";

/** Deeper children stop indenting so titles keep their width. */
const MAX_INDENT_DEPTH = 3;
const DATE_GROUP_LIMIT = 5;
const EMPTY_THREADS: readonly PluginSidebarThread[] = [];

const WORKING_STATUSES = new Set(["active", "provisioning", "starting", "stopping"]);

/** bb's own definition of "working": the one its spinner glyph follows. */
function isWorking(thread: PluginSidebarThread): boolean {
  return (
    WORKING_STATUSES.has(thread.runtimeStatus) ||
    Object.values(thread.activity).some((count) => count > 0)
  );
}

function isVisible(thread: PluginSidebarThread): boolean {
  return !thread.isHidden && !thread.isArchived;
}

/** A root thread with what its whole subtree adds up to. */
interface Tree {
  root: PluginSidebarThread;
  ids: string[];
  anyWorking: boolean;
  anyUnread: boolean;
  lastAttentionAt: number;
}

/** Working subtrees first, then the latest finished turn anywhere inside. */
function byAttention(a: Tree, b: Tree): number {
  const working = Number(b.anyWorking) - Number(a.anyWorking);
  if (working !== 0) return working;
  return b.lastAttentionAt - a.lastAttentionAt || b.root.createdAt - a.root.createdAt;
}

function byPin(a: Tree, b: Tree): number {
  const x = a.root;
  const y = b.root;
  if (x.pinSortKey !== null && y.pinSortKey !== null) {
    return x.pinSortKey < y.pinSortKey ? -1 : x.pinSortKey > y.pinSortKey ? 1 : 0;
  }
  if (x.pinSortKey !== null) return -1;
  if (y.pinSortKey !== null) return 1;
  return (x.pinnedAt ?? 0) - (y.pinnedAt ?? 0);
}

/**
 * Splits visible threads into trees. A thread nests under its parent only
 * when that parent is visible, the chain has no cycle, and the thread itself
 * is not pinned (a pinned child shows in Pinned, as bb's drag-pin does).
 */
function buildTrees(threads: readonly PluginSidebarThread[]) {
  const visible = threads.filter(isVisible);
  const byId = new Map(visible.map((thread) => [thread.id, thread]));
  const parentOf = (thread: PluginSidebarThread): string | null => {
    if (thread.isPinned || thread.parentThreadId === null) return null;
    if (!byId.has(thread.parentThreadId)) return null;
    const seen = new Set([thread.id]);
    for (let id: string | null = thread.parentThreadId; id !== null; ) {
      if (seen.has(id)) return null; // cycle: show this thread as a root
      seen.add(id);
      const ancestor = byId.get(id);
      if (ancestor === undefined || ancestor.isPinned) break;
      id = ancestor.parentThreadId;
    }
    return thread.parentThreadId;
  };
  const childrenOf = new Map<string, PluginSidebarThread[]>();
  const roots: PluginSidebarThread[] = [];
  for (const thread of visible) {
    const parentId = parentOf(thread);
    if (parentId === null) {
      roots.push(thread);
    } else {
      const siblings = childrenOf.get(parentId) ?? [];
      siblings.push(thread);
      childrenOf.set(parentId, siblings);
    }
  }
  for (const siblings of childrenOf.values()) {
    siblings.sort((a, b) => a.createdAt - b.createdAt);
  }
  const rootOf = new Map<string, string>();
  const trees: Tree[] = roots.map((root) => {
    const tree: Tree = {
      root,
      ids: [],
      anyWorking: false,
      anyUnread: false,
      lastAttentionAt: 0,
    };
    const stack = [root];
    while (stack.length > 0) {
      const thread = stack.pop()!;
      if (rootOf.has(thread.id)) continue;
      rootOf.set(thread.id, root.id);
      tree.ids.push(thread.id);
      tree.anyWorking ||= isWorking(thread);
      tree.anyUnread ||= thread.isUnread;
      tree.lastAttentionAt = Math.max(tree.lastAttentionAt, thread.latestAttentionAt);
      stack.push(...(childrenOf.get(thread.id) ?? []));
    }
    return tree;
  });
  return { trees, childrenOf, rootOf };
}

function warn(action: string) {
  return (error: unknown) => console.warn(`[codex-sidebar] ${action} failed`, error);
}

/** The Priority set; null until the first load so rows don't jump on mount. */
function usePriority() {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const [priority, setPriority] = useState<PriorityMap | null>(null);
  const refetch = useCallback(() => {
    rpc.call("priority_list").then(
      (result) => setPriority(result.priority),
      (error: unknown) => {
        warn("priority_list")(error);
        // Show the list without stored Priority rather than loading forever.
        setPriority((current) => current ?? {});
      },
    );
  }, [rpc]);
  // RPC works independently of the realtime connection.
  useEffect(refetch, [refetch]);
  const previousConnection = useRef(connection);
  useEffect(() => {
    if (connection === "connected" && previousConnection.current !== "connected") refetch();
    previousConnection.current = connection;
  }, [connection, refetch]);
  useRealtime(PRIORITY_CHANGED, refetch);
  const add = useCallback(
    (threadIds: string[]) => {
      if (threadIds.length === 0) return;
      rpc.call("priority_add", { threadIds }).then(
        (result) => setPriority(result.priority),
        warn("priority_add"),
      );
    },
    [rpc],
  );
  const remove = useCallback(
    (threadIds: string[]) => {
      if (threadIds.length === 0) return;
      rpc.call("priority_remove", { threadIds }).then(
        (result) => setPriority(result.priority),
        warn("priority_remove"),
      );
    },
    [rpc],
  );
  return { priority, add, remove };
}

function startOfDay(epochMs: number): Date {
  const date = new Date(epochMs);
  date.setHours(0, 0, 0, 0);
  return date;
}

/** Keep calendar groups current across midnight, suspended timers and clock changes. */
function useToday(): number {
  const [today, setToday] = useState(() => startOfDay(Date.now()).getTime());
  useEffect(() => {
    let timer: number | undefined;
    const sync = () => {
      const now = Date.now();
      setToday(startOfDay(now).getTime());
      if (timer !== undefined) window.clearTimeout(timer);
      // Derive the next midnight from the current wall clock, not cached state.
      const nextMidnight = startOfDay(now);
      nextMidnight.setDate(nextMidnight.getDate() + 1);
      timer = window.setTimeout(sync, Math.max(1_000, nextMidnight.getTime() - now + 1_000));
    };
    const onVisible = () => { if (document.visibilityState !== "hidden") sync(); };
    window.addEventListener("focus", sync);
    window.addEventListener("pageshow", sync);
    document.addEventListener("visibilitychange", onVisible);
    sync();
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener("focus", sync);
      window.removeEventListener("pageshow", sync);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return today;
}

const weekdayFormat = new Intl.DateTimeFormat("ru", { weekday: "long" });
const monthFormat = new Intl.DateTimeFormat("ru", { month: "long" });
const monthYearFormat = new Intl.DateTimeFormat("ru", {
  month: "long",
  year: "numeric",
});

function dayGroup(epochMs: number, today: number): { key: string; label: string } {
  const day = startOfDay(epochMs);
  const daysAgo = Math.round((today - day.getTime()) / 86_400_000);
  if (daysAgo <= 0) return { key: "today", label: "Сегодня" };
  if (daysAgo === 1) return { key: "yesterday", label: "Вчера" };
  if (daysAgo < 7) return { key: `day-${daysAgo}`, label: weekdayFormat.format(day) };
  const sameYear = day.getFullYear() === new Date(today).getFullYear();
  return {
    key: `month-${day.getFullYear()}-${day.getMonth()}`,
    label: (sameYear ? monthFormat : monthYearFormat).format(day),
  };
}

interface Group {
  key: string;
  label: string;
  trees: Tree[];
}

function GroupHeader({
  label,
  action,
}: {
  label: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-2 px-2 py-1">
      <span className="text-xs font-medium text-sidebar-foreground/75 first-letter:uppercase">
        {label}
      </span>
      {action}
    </div>
  );
}

const iconButton =
  "flex size-6 items-center justify-center rounded-md text-subtle-foreground outline-none ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-1 focus-visible:ring-inset disabled:pointer-events-none disabled:opacity-40";

function switchToProjectsOrBack() {
  toggleSidebarView().catch(warn("toggle-view"));
}

const EXPANDED_KEY = "codex-sidebar.expanded-threads.v1";

function readExpanded(): Set<string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? "[]");
    return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []);
  } catch { return new Set(); }
}

function useExpandedThreads(activeAncestors: string) {
  const [expanded, setExpanded] = useState(readExpanded);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === EXPANDED_KEY || event.key === null) setExpanded(readExpanded());
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  useEffect(() => {
    try { localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expanded])); }
    catch { /* Folding remains usable when browser storage is unavailable. */ }
  }, [expanded]);
  // Reveal the selected child on navigation, but allow manually folding it.
  useEffect(() => {
    const ids: string[] = JSON.parse(activeAncestors);
    if (ids.length) setExpanded((previous) => new Set([...previous, ...ids]));
  }, [activeAncestors]);
  const toggle = useCallback((id: string) => setExpanded((previous) => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  }), []);
  return { expanded, toggle };
}

function CodexThreadList({ activeThreadId, onNavigate }: PluginThreadListProps) {
  const { status, threads, projects } = useSidebarThreads();
  const { providers } = useProviders();
  const providersById = useMemo(() => new Map(providers.map((provider) => [provider.id, provider])), [providers]);
  const { priority, add, remove } = usePriority();
  const today = useToday();
  const { showPinned, setShowPinned } = useShowPinned();
  const { showPriority, setShowPriority } = useShowPriority();
  const sdk = useSdk();
  const [expandedDates, setExpandedDates] = useState<Set<string>>(() => new Set());
  const [reading, setReading] = useState(false);
  const readPending = useRef(false);
  const [readError, setReadError] = useState("");
  const unreadIds = threads.filter(thread => isVisible(thread) && thread.isUnread).map(thread => thread.id);
  async function markAllRead() {
    if (readPending.current || unreadIds.length === 0) return;
    readPending.current = true; setReading(true); setReadError("");
    try {
      for (const threadId of unreadIds) await sdk.threads.markRead({ threadId });
    } catch (error) {
      warn("mark all read")(error);
      setReadError("Не удалось отметить всё. Попробуйте ещё раз.");
    } finally { readPending.current = false; setReading(false); }
  }

  const projectNames = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );

  const { trees, childrenOf } = useMemo(() => buildTrees(threads), [threads]);
  const activeAncestors = useMemo(() => {
    const parents = new Map<string, string>();
    for (const [parent, children] of childrenOf) {
      for (const child of children) parents.set(child.id, parent);
    }
    const ancestors: string[] = [];
    const seen = new Set<string>();
    let id = activeThreadId;
    while (id && parents.has(id) && !seen.has(id)) {
      seen.add(id);
      id = parents.get(id)!;
      ancestors.push(id);
    }
    return JSON.stringify(ancestors);
  }, [activeThreadId, childrenOf]);
  const { expanded, toggle } = useExpandedThreads(activeAncestors);
  const descendantsById = useMemo(() => {
    const result = new Map<string, PluginSidebarThread[]>();
    const visit = (thread: PluginSidebarThread): PluginSidebarThread[] => {
      const descendants = (childrenOf.get(thread.id) ?? []).flatMap(child => [child, ...visit(child)]);
      result.set(thread.id, descendants);
      return descendants;
    };
    trees.forEach(tree => visit(tree.root));
    return result;
  }, [trees, childrenOf]);

  // Working or unread threads join Priority immediately and remain there after
  // reading until clear-read is used. Bound the candidate set before filtering
  // missing IDs so a full server store cannot cause endless eviction/re-adds.
  const missingKey = useMemo(() => {
    if (priority === null) return "";
    return threads
      .filter((thread) => isVisible(thread) && (isWorking(thread) || thread.isUnread))
      .sort((a, b) => Number(isWorking(b)) - Number(isWorking(a)) || b.latestAttentionAt - a.latestAttentionAt || a.id.localeCompare(b.id))
      .slice(0, MAX_PRIORITY_ENTRIES)
      .filter((thread) => priority[thread.id] === undefined)
      .map((thread) => thread.id)
      .join(",");
  }, [threads, priority]);
  useEffect(() => {
    if (missingKey !== "") add(missingKey.split(","));
  }, [missingKey, add]);

  const { pinnedTrees, priorityTrees, dayGroups } = useMemo(() => {
    const pinnedTrees: Tree[] = [];
    const priorityTrees: Tree[] = [];
    const rest: Tree[] = [];
    for (const tree of trees) {
      if (tree.root.isPinned) pinnedTrees.push(tree);
      else if (showPriority && (tree.anyWorking || tree.anyUnread || tree.ids.some((id) => priority?.[id] !== undefined))) priorityTrees.push(tree);
      else rest.push(tree);
    }
    pinnedTrees.sort(byPin);
    priorityTrees.sort(byAttention);
    rest.sort(byAttention);
    const dayGroups: Group[] = [];
    const byKey = new Map<string, Group>();
    for (const tree of rest) {
      const { key, label } = dayGroup(tree.lastAttentionAt, today);
      let group = byKey.get(key);
      if (group === undefined) {
        group = { key, label, trees: [] };
        byKey.set(key, group);
        dayGroups.push(group);
      }
      group.trees.push(tree);
    }
    return { pinnedTrees, priorityTrees, dayGroups };
  }, [trees, priority, today, showPriority]);

  // Date scope uses calendar identity so today's order follows the day at midnight.
  const dateScope = (group: Group) => group.key.startsWith("month-") ? group.key
    : `date:${startOfDay(group.trees[0].lastAttentionAt).getTime()}`;
  const orderGroups = new Map<string, string[]>();
  const registerChildren = (scope: string, thread: PluginSidebarThread) => {
    const children = childrenOf.get(thread.id) ?? EMPTY_THREADS;
    const childScope = `${scope}/children:${thread.id}`;
    orderGroups.set(childScope, children.map(child => child.id));
    children.forEach(child => registerChildren(scope, child));
  };
  for (const [scope, list] of [["pinned", pinnedTrees], ["priority", priorityTrees], ...dayGroups.map(group => [dateScope(group), group.trees])] as [string, Tree[]][]) {
    orderGroups.set(scope, list.map(tree => tree.root.id));
    list.forEach(tree => registerChildren(scope, tree.root));
  }
  const rowOrder = useRowOrder(orderGroups);

  // "Clear read": drop finished subtrees the user has already seen. Anything
  // working or unread inside a subtree keeps its whole tree in Priority.
  const clearable = [...priorityTrees, ...pinnedTrees]
    .filter((tree) => !tree.anyWorking && !tree.anyUnread)
    .flatMap((tree) => tree.ids)
    .filter((id) => priority?.[id] !== undefined);

  const renderThread = (thread: PluginSidebarThread, section: string, scope: string, depth = 0, parentProjectId?: string): ReactNode => {
    const childScope = `${section}/children:${thread.id}`;
    const children = rowOrder.sort(childScope, childrenOf.get(thread.id) ?? EMPTY_THREADS, child => child.id);
    const isExpanded = expanded.has(thread.id);
    return (
      <li key={thread.id}>
        <NativeThreadRow orderScope={scope} onReorderStart={rowOrder.start} thread={thread} provider={providersById.get(thread.providerId ?? "")}
          projectName={projectNames.get(thread.projectId) ?? ""}
          showProject={thread.projectId !== parentProjectId}
          depth={Math.min(depth, MAX_INDENT_DEPTH)} children={children}
          descendants={descendantsById.get(thread.id) ?? EMPTY_THREADS}
          expanded={isExpanded} active={thread.id === activeThreadId}
          onToggle={toggle} onNavigate={onNavigate} />
        {children.length > 0 ? (
          <ul id={`codex-children-${thread.id}`} className="relative flex flex-col" hidden={!isExpanded}>
            {isExpanded && depth < MAX_INDENT_DEPTH ? <li aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 w-px bg-border opacity-70"
              style={{ left: 16 + depth * 24 }} /> : null}
            {isExpanded ? children.map(child => renderThread(child, section, childScope, depth + 1, thread.projectId)) : null}
          </ul>
        ) : null}
      </li>
    );
  };
  const renderTrees = (list: Tree[], scope: string, limitByDate = false) => {
    const ordered = rowOrder.sort(scope, list, tree => tree.root.id);
    const isExpanded = expandedDates.has(scope);
    const canExpand = limitByDate && ordered.length > DATE_GROUP_LIMIT;
    // Keep the selected thread's entire tree visible beyond the first five.
    const visible = canExpand && !isExpanded
      ? ordered.filter((tree, index) => index < DATE_GROUP_LIMIT || (activeThreadId !== null && tree.ids.includes(activeThreadId)))
      : ordered;
    return (
      <>
        <ul id={`codex-group-${scope}`} className="flex flex-col">
          {visible.map(tree => renderThread(tree.root, scope, scope))}
        </ul>
        {canExpand ? (
          <button type="button" aria-expanded={isExpanded} aria-controls={`codex-group-${scope}`}
            className="ml-[22px] mt-0.5 inline-flex h-7 items-center rounded-md px-2 text-[13px] text-subtle-foreground outline-none hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-1 focus-visible:ring-sidebar-ring"
            onClick={() => setExpandedDates(previous => {
              const next = new Set(previous);
              if (next.has(scope)) next.delete(scope); else next.add(scope);
              return next;
            })}>
            {isExpanded ? "Показать меньше" : "Показать больше"}
          </button>
        ) : null}
      </>
    );
  };

  if ((status === "loading" && threads.length === 0) || priority === null) {
    return (
      <p data-codex-priority-view="" role="status" className="px-4 py-3 text-xs text-subtle-foreground">
        Загружаю треды…
      </p>
    );
  }
  if (status === "error" && threads.length === 0) {
    return (
      <p data-codex-priority-view="" role="alert" className="px-4 py-3 text-xs text-subtle-foreground">
        Не удалось загрузить треды.
      </p>
    );
  }

  const viewOptions = (<ViewOptions showPinned={showPinned} onChange={setShowPinned} buttonClass={iconButton}
              showPriority={showPriority} onPriorityChange={setShowPriority}
              onReadAll={markAllRead} canRead={unreadIds.length > 0} reading={reading} readError={readError} />);

  return (
    <nav onClickCapture={event => { if (rowOrder.suppressClick()) { event.preventDefault(); event.stopPropagation(); } }} data-codex-priority-view="" aria-label="Треды" className="flex flex-col gap-1 px-2 pb-3">

      {!showPinned || pinnedTrees.length === 0 ? null : (
        <section aria-label="Закреплённые">
          <GroupHeader label="Закреплённые" />
          {renderTrees(pinnedTrees, "pinned")}
        </section>
      )}
      {showPriority ? <section aria-label="Приоритет">
        <GroupHeader
          label="Приоритет"
          action={
            <div className="flex shrink-0 items-center gap-1">
            {viewOptions}
            <button type="button" title="Убрать прочитанные" aria-label="Убрать прочитанные"
              disabled={clearable.length === 0} onClick={() => remove(clearable)} className={iconButton}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m15 4 5 5a2 2 0 0 1 0 3l-8 8H8l-5-5a2 2 0 0 1 0-3l9-8a2 2 0 0 1 3 0Z" />
                <path d="m7 9 8 8" />
              </svg>
            </button>
            </div>
          }
        />
        {priorityTrees.length === 0 ? (
          <p className="px-2 py-1.5 text-sm text-subtle-foreground">Пусто</p>
        ) : (
          renderTrees(priorityTrees, "priority")
        )}
      </section> : null}
      {!showPriority && dayGroups.length === 0 ? <GroupHeader label="Сегодня" action={viewOptions} /> : null}
      {dayGroups.map((group, index) => (
        <section key={group.key} aria-label={group.label}>
          <GroupHeader label={group.label} action={!showPriority && index === 0 ? viewOptions : undefined} />
          {renderTrees(group.trees, dateScope(group), true)}
        </section>
      ))}
    </nav>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_threadList({
    id: LIST_ID,
    title: "Codex-style list",
    description: "Priority on top, then threads by day; sub-threads nest under their parent.",
    component: CodexThreadList,
  });
  app.contentScripts.register({
    id: "sidebar-header-toggle",
    mount: mountSidebarToggle,
  });
  app.contentScripts.register({
    id: "native-project-limit",
    mount: mountNativeProjectLimit,
  });
  // No default shortcut yet; bind one in bb's keyboard settings.
  app.commands.register({
    id: "toggle-view",
    title: "Сайдбар: приоритет / по проектам",
    run: switchToProjectsOrBack,
  });
});
