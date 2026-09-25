// In-page React commit counter for performance and render-count tests.
//
// Installed with page.addInitScript before React loads, it stands in for the
// React DevTools global hook, which both development and production React DOM
// call after every commit. Each commit walks only the fibers React actually
// visited: a child list that was not cloned (child === alternate.child) was
// skipped by a bailout, so its subtree is not counted. A visited component
// fiber with the PerformedWork flag ran its render function.
//
// Rows are recognised by their host element class, not by component name, so
// the counter also works on minified production builds.
//
// window.__reactCommitCounter:
//   enabled            count only while true (timing samples leave it off)
//   reset()            zero the counters
//   read()             { commits, componentRenders, rowRenders: { [class]: n }, rowIds: { [class]: [...] } }
//   trackRows(classes) host element classes whose owning component is a "row"
export function installReactCommitCounter() {
  const PERFORMED_WORK = 1;
  const FUNCTION_COMPONENT = 0;
  const CLASS_COMPONENT = 1;
  const FORWARD_REF = 11;
  const SIMPLE_MEMO_COMPONENT = 15;
  const HOST_COMPONENT = 5;
  const state = { commits: 0, componentRenders: 0, rowRenders: {}, rowIds: {} };
  let rowClasses = [];

  function isComponent(fiber) {
    return fiber.tag === FUNCTION_COMPONENT
      || fiber.tag === CLASS_COMPONENT
      || fiber.tag === FORWARD_REF
      || fiber.tag === SIMPLE_MEMO_COMPONENT;
  }

  function rowClassOf(fiber) {
    const host = fiber.child;
    if (!host || host.tag !== HOST_COMPONENT || !host.stateNode?.classList) return null;
    return rowClasses.find((name) => host.stateNode.classList.contains(name)) ?? null;
  }

  function recordRender(fiber) {
    state.componentRenders += 1;
    const rowClass = rowClassOf(fiber);
    if (!rowClass) return;
    state.rowRenders[rowClass] = (state.rowRenders[rowClass] ?? 0) + 1;
    const id = fiber.child.stateNode.id;
    if (id) (state.rowIds[rowClass] ??= []).push(id);
  }

  function walk(fiber) {
    // Iterative so a 2,000-row list cannot overflow the stack.
    const stack = [fiber];
    while (stack.length) {
      const next = stack.pop();
      const previous = next.alternate;
      if (isComponent(next) && (previous === null || (next.flags & PERFORMED_WORK) === PERFORMED_WORK)) {
        recordRender(next);
      }
      // A mounted fiber, or one whose children were re-created this render.
      if (next.child && (previous === null || next.child !== previous.child)) {
        for (let child = next.child; child; child = child.sibling) stack.push(child);
      }
    }
  }

  const counter = {
    enabled: false,
    reset() {
      state.commits = 0;
      state.componentRenders = 0;
      state.rowRenders = {};
      state.rowIds = {};
    },
    read() {
      return JSON.parse(JSON.stringify(state));
    },
    trackRows(classes) {
      rowClasses = [...classes];
    }
  };
  window.__reactCommitCounter = counter;

  let rendererId = 0;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    renderers: new Map(),
    supportsFiber: true,
    isDisabled: false,
    inject(renderer) {
      rendererId += 1;
      this.renderers.set(rendererId, renderer);
      return rendererId;
    },
    checkDCE() {},
    onScheduleFiberRoot() {},
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    onCommitFiberRoot(_id, root) {
      if (!counter.enabled) return;
      state.commits += 1;
      walk(root.current);
    }
  };
}
