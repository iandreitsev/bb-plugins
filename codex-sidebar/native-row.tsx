import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  ThreadTitle, experimental_ProviderIcon as ProviderIcon,
  experimental_Icon as Icon,
  experimental_ThreadActionsContextMenu as ThreadActionsContextMenu,
  experimental_ThreadActionsMenu as ThreadActionsMenu,
  experimental_ThreadStatusGlyph as ThreadStatusGlyph,
  experimental_useThreadActions as useThreadActions,
  experimental_useSidebarThreadSplit as useSidebarThreadSplit,
  useBbNavigate, useSidebarThreadDraftIds, useSidebarThreadRowStatus,
  useSidebarThreadShortcut,
  type PluginSidebarThread, type ExperimentalProviderIconProps,
} from "@get-bb/plugin-sdk/app";
import {
  threadListIndicatorStateForThread, getCollapsedChildActivity,
  resolveThreadListIndicator, type ThreadListIndicatorState,
} from "./native-thread-activity";
import "./native-row.css";

const ROW_ACTIONS = ["bb--core/copyLink", "bb--core/rename"];

export const NativeThreadRow = memo(function NativeThreadRow({
  thread, provider, projectName, showProject = true, depth, children, descendants,
  expanded, active, onToggle, onNavigate, orderScope, onReorderStart,
}: {
  orderScope: string;
  onReorderStart: (event: import("react").PointerEvent<HTMLElement>, scope: string, id: string) => void;
  thread: PluginSidebarThread;
  provider: ExperimentalProviderIconProps["provider"] | undefined;
  projectName: string;
  showProject?: boolean;
  depth: number;
  children: readonly PluginSidebarThread[];
  descendants: readonly PluginSidebarThread[];
  expanded: boolean;
  active: boolean;
  onToggle: (id: string) => void;
  onNavigate: () => void;
}) {
  const titleRef = useRef<HTMLSpanElement>(null);
  const [titleOverflows, setTitleOverflows] = useState(false);
  useEffect(() => {
    const element = titleRef.current;
    if (!element) return;
    const measure = () => setTitleOverflows(element.scrollWidth > element.clientWidth + 1);
    measure();
    const resize = typeof window.ResizeObserver === "function" ? new window.ResizeObserver(measure) : null;
    resize?.observe(element);
    const mutation = new window.MutationObserver(measure);
    mutation.observe(element, { childList: true, subtree: true, characterData: true });
    return () => { resize?.disconnect(); mutation.disconnect(); };
  }, [thread.id, projectName, showProject]);
  const navigate = useBbNavigate();
  const draftIds = useSidebarThreadDraftIds();
  const rowStatus = useSidebarThreadRowStatus(thread.id);
  const shortcut = useSidebarThreadShortcut(thread.id);
  const split = useSidebarThreadSplit(thread.id);
  const [menuOpen, setMenuOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [runningAction, setRunningAction] = useState(false);
  const hasChildren = children.length > 0;
  const hidden = hasChildren && !expanded;
  const state = threadListIndicatorStateForThread(thread, draftIds.has(thread.id));
  const child = getCollapsedChildActivity(hidden ? descendants : []);
  const combined: ThreadListIndicatorState = {
    ...state,
    hasPendingInteraction: state.hasPendingInteraction || child.pending,
    hasUnsubmittedDraft: state.hasUnsubmittedDraft || (hidden && descendants.some(t => draftIds.has(t.id))),
    hasUnreadError: state.hasUnreadError || child.unreadError,
    hasUnreadSuccess: state.hasUnreadSuccess || child.unread,
    isRuntimeActive: state.isRuntimeActive || child.runtimeWorking,
    isWorkflowActive: state.isWorkflowActive || child.workflow,
    isBackgroundAgentActive: state.isBackgroundAgentActive || child.backgroundAgent,
    isBackgroundCommandActive: state.isBackgroundCommandActive || child.backgroundCommand,
    isPlanModeActive: state.isPlanModeActive || child.planMode,
    isGoalActive: state.isGoalActive || child.goal,
  };
  const indicator = resolveThreadListIndicator(combined);
  const target = useMemo(() => ({
    id: thread.id, projectId: thread.projectId, parentThreadId: thread.parentThreadId,
    archivedAt: thread.archivedAt, pinnedAt: thread.pinnedAt, sectionId: thread.sectionId,
    isUnread: thread.isUnread, status: thread.status,
    environment: thread.environment?.id ? {id: thread.environment.id, path: thread.environment.path} : null,
  }), [thread]);
  const actions = useThreadActions(target, { keys: ROW_ACTIONS });
  const copyLink = actions.find(action => action.key === "bb--core/copyLink");
  const rename = actions.find(action => action.key === "bb--core/rename");
  const open = menuOpen || contextOpen;
  return (
    <ThreadActionsContextMenu thread={target} onOpenChange={setContextOpen}>
      <div {...split.splitProps} data-order-id={thread.id} data-order-scope={orderScope}
        onPointerDown={event => { split.splitProps.onPointerDown?.(event); onReorderStart(event, orderScope, thread.id); }}
        onDragStart={event => event.preventDefault()} data-codex-native-row="" data-active={active || undefined}
        data-menu-open={open || undefined} data-codex-thread-row={thread.id}
        style={{ paddingLeft: 8 + depth * 24 }}>
        <span className="cs-content" data-has-children={hasChildren || undefined}>
        <a href={thread.href} draggable={false} data-sidebar-thread-shortcut-target=""
          data-sidebar-thread-id={thread.id} aria-current={active ? "page" : undefined}
          aria-label={thread.displayTitle} aria-keyshortcuts={shortcut?.ariaKeyshortcuts}
          title={projectName ? `${thread.displayTitle} — ${projectName}` : thread.displayTitle}
          onDoubleClick={event => {
            if (!rename) return;
            event.preventDefault();
            rename.action.run().catch(error => console.warn('[codex-sidebar] rename failed', error));
          }}
          onClick={event => {
            if (split.isAvailable && (event.metaKey || event.ctrlKey)) {
              event.preventDefault(); navigate.toThread(thread.id, {split:true});
            }
            onNavigate();
          }} className="cs-row-link">
          {provider ? <ProviderIcon providerKind="agent" provider={provider} className="size-4 shrink-0" /> : null}
          <span ref={titleRef} className="cs-row-title" data-overflow={titleOverflows || undefined}>
            <span className="cs-title-text"><ThreadTitle threadId={thread.id} /></span>
          </span>
          {showProject && projectName ? <span className="cs-row-project">{projectName}</span> : null}
        </a>
        {hasChildren ? <button type="button" className="cs-disclosure"
          aria-expanded={expanded} aria-controls={`codex-children-${thread.id}`}
          aria-label={`${expanded ? "Свернуть" : "Развернуть"} дочерние треды: ${thread.displayTitle}`}
          title={`${expanded ? "Свернуть" : "Развернуть"} дочерние треды (${descendants.length})`}
          onPointerDown={e=>e.stopPropagation()}
          onClick={e=>{e.preventDefault();e.stopPropagation();onToggle(thread.id);}}>
          <Icon name="ChevronRight" className="size-3" />
        </button> : null}
        </span>
        <span className="cs-trailing" data-sidebar-thread-trailing="">
          {shortcut ? <span className="cs-shortcut">{shortcut.label}</span> : <>
            <span className="cs-status" data-sidebar-thread-trailing-indicator="">
              <ThreadStatusGlyph indicator={indicator} rowStatus={rowStatus} />
            </span>
            <span className="cs-row-actions" onPointerDown={e=>e.stopPropagation()}>
              {copyLink ? <button type="button" className="cs-action cs-quick-action"
                title={copyLink.action.label} aria-label={copyLink.action.label}
                disabled={copyLink.action.disabled || runningAction}
                onClick={()=>{
                  setRunningAction(true);
                  copyLink.action.run().catch(error=>console.warn('[codex-sidebar] copy link failed',error))
                    .finally(()=>setRunningAction(false));
                }}><Icon name={copyLink.action.icon} className="size-4" /></button> : null}
              <ThreadActionsMenu thread={target} onOpenChange={setMenuOpen} side="right" align="start" sideOffset={8}
                trigger={props=><button {...props} type="button" className="cs-action"
                  aria-label="Thread actions" title="Thread actions" data-thread-actions-trigger="">
                  <Icon name="MoreHorizontal" className="size-4" />
                </button>} />
            </span>
          </>}
        </span>
      </div>
    </ThreadActionsContextMenu>
  );
});
