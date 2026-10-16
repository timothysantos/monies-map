import "./splits-group-strip.css";
import { Check, ChevronDown, List, Plus } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { splitsStripCopy as copy } from "./copy/splits-strip-copy";
import { useMoneyPrivacy } from "./money-privacy";
import { SplitsGroupsSheet } from "./splits-groups-sheet";
import {
  buildSheetRows,
  buildStripTiles,
  countTilesThatFit
} from "./splits-group-strip-model";
import { getIconComponent } from "./ui-components";
import { useIsMobileLayout } from "./use-viewport";

// Widths the desktop row is laid out with (splits-group-strip.css uses the
// same numbers); the row shows as many tiles as fit and never wraps.
const DESKTOP_SIZES = { controlWidth: 88, leadWidth: 280, tileWidth: 200, gap: 10 };
const FADE_PX = 16;

// The group strip under the person switcher (design.md, "Splits group
// strip"). A solid New/All control is its own column; the group tiles scroll
// in a separate scroller to its right, so nothing slides under the control.
// The open group leads as a white tile. When the strip has scrolled out of
// view on a phone, a floating bar shows the open group and opens the sheet.
export function SplitsGroupStrip({
  groups,
  activeGroup,
  selectedMode,
  isHousehold = false,
  readOnly = false,
  hideBar = false,
  searchQuery = "",
  onClearSearch,
  onSelectGroup,
  onCreateGroup
}) {
  const { areTotalsVisible } = useMoneyPrivacy();
  const isMobile = useIsMobileLayout();
  const [strip, setStrip] = useState(null);
  const [scroller, setScroller] = useState(null);
  const [rowWidth, setRowWidth] = useState(0);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [isScrolledPast, setIsScrolledPast] = useState(false);
  const inMatches = selectedMode === "matches";
  const activeId = inMatches ? null : (activeGroup?.id ?? null);

  const tiles = useMemo(
    () => buildStripTiles(groups, { activeGroupId: activeId, areTotalsVisible, isHousehold }),
    [activeId, areTotalsVisible, groups, isHousehold]
  );
  const sheetRows = useMemo(
    () => buildSheetRows(groups, { activeGroupId: activeId, areTotalsVisible, isHousehold }),
    [activeId, areTotalsVisible, groups, isHousehold]
  );

  // Desktop: the row does not scroll, so show what fits.
  const visibleCount = isMobile || !rowWidth
    ? tiles.length
    : countTilesThatFit({ ...DESKTOP_SIZES, rowWidth, total: tiles.length });
  const shownTiles = tiles.slice(0, visibleCount);
  const hiddenCount = tiles.length - shownTiles.length;

  useLayoutEffect(() => {
    if (!strip || typeof ResizeObserver === "undefined") {
      return undefined;
    }
    const measure = () => setRowWidth(strip.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [strip]);

  // Soft fades on the scroller's edges: left only once scrolled, right only
  // while more tiles follow.
  useLayoutEffect(() => {
    if (!scroller) {
      return undefined;
    }
    const update = () => {
      const canScroll = scroller.scrollWidth > scroller.clientWidth + 2;
      const left = canScroll && scroller.scrollLeft > 2;
      const right = canScroll && scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 2;
      scroller.style.setProperty("--fade-left", left ? `${FADE_PX}px` : "0px");
      scroller.style.setProperty("--fade-right", right ? `${FADE_PX}px` : "0px");
    };
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(scroller);
    return () => {
      scroller.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, [scroller, shownTiles.length, isMobile]);

  // The open group is the first tile: bring the row back to its start when it changes.
  useEffect(() => {
    scroller?.scrollTo({ left: 0 });
  }, [activeId, scroller]);

  // On a phone the strip leaves the page when scrolled down; the bar takes over.
  useEffect(() => {
    if (!strip || !isMobile || typeof IntersectionObserver === "undefined") {
      setIsScrolledPast(false);
      return undefined;
    }
    const observer = new IntersectionObserver(([entry]) => {
      setIsScrolledPast(!entry.isIntersecting && entry.boundingClientRect.bottom < 0);
    });
    observer.observe(strip);
    return () => observer.disconnect();
  }, [isMobile, strip]);

  if (!groups.length) {
    return null;
  }

  const showBar = isMobile && isScrolledPast && !hideBar && !inMatches && activeGroup && typeof document !== "undefined";
  const activeTile = tiles.find((tile) => tile.isActive);
  const allLabel = hiddenCount > 0 ? copy.allMore(hiddenCount) : copy.allTile;
  const closeSheet = () => setIsSheetOpen(false);

  return (
    <>
      <section ref={setStrip} className="splits-strip" aria-label={copy.allGroups}>
        <div className={`splits-strip-control ${readOnly ? "is-single" : ""}`}>
          {!readOnly ? (
            <button
              type="button"
              className="splits-strip-half splits-strip-new"
              aria-label={copy.createGroup}
              onClick={onCreateGroup}
            >
              <Plus size={16} strokeWidth={2.2} aria-hidden="true" />
              <span>{copy.newTile}</span>
            </button>
          ) : null}
          <button
            type="button"
            className="splits-strip-half splits-strip-all"
            aria-label={copy.allGroups}
            aria-haspopup="dialog"
            onClick={() => setIsSheetOpen(true)}
          >
            <List size={16} strokeWidth={2.2} aria-hidden="true" />
            <span>{allLabel}</span>
          </button>
        </div>
        <div ref={setScroller} className="splits-strip-scroll">
          {shownTiles.map((tile) => (
            <button
              key={tile.id}
              type="button"
              className={`splits-strip-tile ${tile.isActive ? "is-active" : ""} ${tile.isSettled ? "is-settled" : ""}`}
              aria-current={tile.isActive ? "true" : undefined}
              // The open group's tile is its balance, an openable figure
              // (design.md "Openable figures"); another tile opens its group.
              data-fig={tile.isActive ? "splits" : undefined}
              data-fig-arg={tile.isActive ? tile.id : undefined}
              data-fig-name={tile.isActive ? tile.name : undefined}
              onClick={() => onSelectGroup(tile.id)}
            >
              <strong className="splits-strip-tile-name">{tile.name}</strong>
              <span className="splits-strip-tile-balance">{tile.balanceLine}</span>
              {tile.isActive ? <span className="splits-strip-tile-count">{copy.entryCount(tile.entryCount)}</span> : null}
              {tile.isActive ? <span className="splits-strip-tile-tick" aria-hidden="true"><Check size={14} strokeWidth={3} /></span> : null}
            </button>
          ))}
        </div>
      </section>

      {showBar ? createPortal(
        <div className={`splits-group-bar${searchQuery ? " has-search" : ""}`}>
        <button
          type="button"
          className="splits-group-bar-trigger"
          aria-label={copy.allGroups}
          aria-haspopup="dialog"
          onClick={() => setIsSheetOpen(true)}
        >
          <GroupBarIcon iconKey={activeGroup.iconKey} />
          <span className="splits-group-bar-text">
            <strong>{activeGroup.name}</strong>
            <span>{activeTile?.balanceLine}</span>
          </span>
          <ChevronDown size={18} aria-hidden="true" />
        </button>
        {searchQuery ? <button type="button" className="splits-group-bar-clear" aria-label={copy.clearName} onClick={onClearSearch}>{copy.clear}</button> : null}
        </div>,
        document.body
      ) : null}

      <SplitsGroupsSheet
        open={isSheetOpen}
        rows={sheetRows}
        readOnly={readOnly}
        onChoose={(groupId) => {
          closeSheet();
          onSelectGroup(groupId);
        }}
        onCreate={() => {
          closeSheet();
          onCreateGroup();
        }}
        onClose={closeSheet}
      />
    </>
  );
}

function GroupBarIcon({ iconKey }) {
  const Icon = getIconComponent(iconKey);
  return <span className="splits-group-bar-icon" aria-hidden="true"><Icon size={18} strokeWidth={2.1} /></span>;
}
