// Scrolls the Imports page to the control that fixes a blocker
// (import-blockers-model.js targets) and moves focus to it. The sticky
// import bar never covers the target: targets carry scroll-margin-top from
// --import-sticky-offset (import-review.css).
//
// Each fixable section marks itself with data-import-target="<kind>"; a
// statement card also carries data-account-name.

/**
 * @param {{ kind: string, accountName?: string, field?: string }} target
 * @param {ParentNode} [root]
 * @returns {boolean} whether something was found to jump to
 */
export function jumpToImportTarget(target, root = document) {
  const found = findImportTarget(target, root);
  if (!found) {
    return false;
  }
  revealAndFocus(found.scrollTo, found.focus);
  return true;
}

/** Scrolls `element` to the top (below the sticky bar) and focuses it. */
export function revealAndFocus(element, focusElement = element) {
  const prefersReducedMotion = typeof window !== "undefined"
    && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  // "instant", not "auto": the page sets scroll-behavior: smooth.
  element.scrollIntoView({ block: "start", behavior: prefersReducedMotion ? "instant" : "smooth" });
  focusWithoutScroll(focusElement);
}

function focusWithoutScroll(element) {
  if (!isFocusable(element)) {
    // Focusable for this jump only, so a later click inside it does not
    // draw a focus ring.
    element.setAttribute("tabindex", "-1");
    element.addEventListener("blur", () => element.removeAttribute("tabindex"), { once: true });
  }
  element.focus({ preventScroll: true });
}

function isFocusable(element) {
  return element.matches("a[href], button, input, select, textarea, [tabindex]") && !element.hasAttribute("disabled");
}

function findImportTarget(target, root) {
  const section = (kind) => root.querySelector(`[data-import-target="${kind}"]`);
  switch (target.kind) {
    case "account-mapping": {
      const mapping = section("account-mapping");
      if (!mapping) {
        return findImportTarget({ kind: "preview-rows" }, root);
      }
      const selects = Array.from(mapping.querySelectorAll("select"));
      const control = selects.find((select) => !select.value) ?? selects[0] ?? mapping;
      return { scrollTo: control, focus: control };
    }
    case "statement-details":
    case "unknown-categories":
    case "statement-check": {
      const element = section(target.kind);
      if (!element) {
        return findImportTarget({ kind: "preview-rows" }, root);
      }
      const control = target.kind === "statement-details" ? element.querySelector("select") ?? element : element;
      return { scrollTo: element, focus: control };
    }
    case "statement-card": {
      const cards = Array.from(root.querySelectorAll('[data-import-target="statement-card"]'));
      const card = cards.find((element) => element.getAttribute("data-account-name") === target.accountName);
      return card ? { scrollTo: card, focus: card } : findImportTarget({ kind: "preview-rows" }, root);
    }
    case "review-rows": {
      const row = root.querySelector('tr[data-commit-status="needs_review"]');
      if (!row) {
        return findImportTarget({ kind: "preview-rows" }, root);
      }
      return { scrollTo: row, focus: row.querySelector("button") ?? row };
    }
    case "column-mapping": {
      const grid = section("column-mapping");
      if (!grid) {
        return null;
      }
      const selects = Array.from(grid.querySelectorAll("select"));
      const control = selects.find((select) => select.value === target.field) ?? selects[0] ?? grid;
      return { scrollTo: control, focus: control };
    }
    case "intake-queue": {
      // The queue, with focus on the first file that can be opened.
      const element = section("intake-queue");
      if (!element) {
        return null;
      }
      const review = Array.from(element.querySelectorAll(".import-intake-actions button")).find((button) => !button.disabled);
      return { scrollTo: element, focus: review ?? element };
    }
    case "preview-rows": {
      const element = section("preview-rows");
      return element ? { scrollTo: element, focus: element } : null;
    }
    default:
      return null;
  }
}
