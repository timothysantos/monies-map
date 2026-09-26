import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { messages } from "./copy/en-SG";
import { CategoryGlyph } from "./ui-components";
import { categories as defaultCategories } from "../domain/demo-data";
import { GUIDE_TABS, classifyGuideHref, parseGuideMarkdown, tokenizeInline } from "./guide-markdown";
import { useRouteWorkReport } from "./use-route-work-status";
import "./faq-panel.css";

// Each guide is its own lazy chunk: the user guide loads with this page, the
// developer guide only when its tab opens, so readers never download it.
const guideLoaders = {
  user: () => import("../../docs/user-guide.md?raw"),
  developers: () => import("../../docs/developer-guide.md?raw")
};

const guideCache = new Map();

function loadGuide(tabId) {
  if (!guideCache.has(tabId)) {
    const promise = guideLoaders[tabId]().then(
      (module) => parseGuideMarkdown(module.default),
      (error) => {
        // Forget a failed load so "Try again" fetches the chunk again.
        guideCache.delete(tabId);
        throw error;
      }
    );
    guideCache.set(tabId, promise);
  }
  return guideCache.get(tabId);
}

function readGuideTab(searchParams) {
  return searchParams.get("faq") === "developers" ? "developers" : "user";
}

export function FaqPanel({ viewLabel }) {
  // Static content: ready as soon as it renders, never busy.
  useRouteWorkReport();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const activeTab = readGuideTab(searchParams);
  const [guideState, setGuideState] = useState({ tab: null, doc: null, error: null });
  const [attempt, setAttempt] = useState(0);
  const tabRefs = useRef({});
  const pendingAnchorRef = useRef(location.hash ? decodeURIComponent(location.hash.slice(1)) : "");

  useEffect(() => {
    let isCurrent = true;
    loadGuide(activeTab).then(
      (doc) => {
        if (isCurrent) setGuideState({ tab: activeTab, doc, error: null });
      },
      (error) => {
        if (isCurrent) setGuideState({ tab: activeTab, doc: null, error });
      }
    );
    return () => {
      isCurrent = false;
    };
  }, [activeTab, attempt]);

  const doc = guideState.tab === activeTab ? guideState.doc : null;
  const loadError = guideState.tab === activeTab ? guideState.error : null;

  // A deep link such as /faq?faq=developers#local-development scrolls once
  // the guide that holds the anchor has rendered.
  useEffect(() => {
    if (!doc || !pendingAnchorRef.current) return;
    const target = document.getElementById(pendingAnchorRef.current);
    pendingAnchorRef.current = "";
    target?.scrollIntoView({ block: "start" });
  }, [doc]);

  function selectTab(tabId, { anchor = "" } = {}) {
    pendingAnchorRef.current = anchor;
    if (tabId === activeTab) {
      if (anchor) document.getElementById(anchor)?.scrollIntoView({ block: "start" });
      return;
    }
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (tabId === "developers") next.set("faq", "developers");
      else next.delete("faq");
      return next;
    });
  }

  function handleTabKeyDown(event) {
    const index = GUIDE_TABS.indexOf(activeTab);
    const keyTargets = {
      ArrowRight: GUIDE_TABS[(index + 1) % GUIDE_TABS.length],
      ArrowLeft: GUIDE_TABS[(index - 1 + GUIDE_TABS.length) % GUIDE_TABS.length],
      Home: GUIDE_TABS[0],
      End: GUIDE_TABS[GUIDE_TABS.length - 1]
    };
    const nextTab = keyTargets[event.key];
    if (!nextTab) return;
    event.preventDefault();
    selectTab(nextTab);
    tabRefs.current[nextTab]?.focus();
  }

  function handleLinkClick(event, href) {
    const target = classifyGuideHref(href, activeTab);
    if (target.kind === "anchor") {
      event.preventDefault();
      if (target.tab === activeTab && target.anchor) {
        window.history.replaceState(window.history.state, "", `${location.pathname}${location.search}#${target.anchor}`);
      }
      selectTab(GUIDE_TABS.includes(target.tab) ? target.tab : "user", { anchor: target.anchor });
    } else if (target.kind === "route") {
      event.preventDefault();
      navigate(href);
    }
  }

  return (
    <article className="panel faq-panel">
      <div className="panel-head">
        <div>
          <h2>{messages.tabs.faq}</h2>
          <span className="panel-context">{messages.faq.viewing(viewLabel)}</span>
        </div>
      </div>
      <div className="faq-tabs pill-row" role="tablist" aria-label={messages.faq.tabsLabel} onKeyDown={handleTabKeyDown}>
        {GUIDE_TABS.map((tabId) => (
          <button
            key={tabId}
            ref={(element) => {
              tabRefs.current[tabId] = element;
            }}
            id={`faq-tab-${tabId}`}
            type="button"
            role="tab"
            className={`pill faq-tab ${tabId === activeTab ? "is-active" : ""}`}
            aria-selected={tabId === activeTab}
            aria-controls={`faq-tabpanel-${tabId}`}
            tabIndex={tabId === activeTab ? 0 : -1}
            onClick={() => selectTab(tabId)}
          >
            {messages.faq.tabs[tabId]}
          </button>
        ))}
      </div>
      <div
        id={`faq-tabpanel-${activeTab}`}
        className="faq-tabpanel"
        role="tabpanel"
        aria-labelledby={`faq-tab-${activeTab}`}
        tabIndex={0}
      >
        {doc ? (
          <GuideDocument doc={doc} onLinkClick={handleLinkClick} />
        ) : loadError ? (
          <div className="faq-guide-status" role="alert">
            <p>{messages.faq.loadFailed}</p>
            <button type="button" className="ghost-button" onClick={() => setAttempt((count) => count + 1)}>
              {messages.faq.retry}
            </button>
          </div>
        ) : (
          <p className="faq-guide-status" role="status">{messages.faq.loading}</p>
        )}
      </div>
    </article>
  );
}

function GuideDocument({ doc, onLinkClick }) {
  return (
    <>
      {doc.toc.length ? <GuideContents toc={doc.toc} onLinkClick={onLinkClick} /> : null}
      <div className="faq-list">
        {doc.entries.map((entry, entryIndex) => {
          const key = entry.id || `intro-${entryIndex}`;
          if (entry.kind === "part") {
            return (
              <section key={key} className="faq-part" aria-labelledby={entry.id}>
                <h3 id={entry.id} className="faq-part-title">{entry.title}</h3>
                <GuideBlocks blocks={entry.blocks} entryKey={key} onLinkClick={onLinkClick} />
              </section>
            );
          }
          return (
            <article key={key} className="faq-item">
              {entry.title ? <h4 id={entry.id}>{entry.title}</h4> : null}
              <GuideBlocks blocks={entry.blocks} entryKey={key} onLinkClick={onLinkClick} />
            </article>
          );
        })}
      </div>
    </>
  );
}

function GuideContents({ toc, onLinkClick }) {
  return (
    <nav className="faq-toc" aria-label={messages.faq.contents}>
      <h3>{messages.faq.contents}</h3>
      <ol>
        {toc.map((part) => (
          <li key={part.id}>
            <a href={`#${part.id}`} onClick={(event) => onLinkClick(event, `#${part.id}`)}>{part.title}</a>
            {part.sections.length ? (
              <ol>
                {part.sections.map((section) => (
                  <li key={section.id}>
                    <a href={`#${section.id}`} onClick={(event) => onLinkClick(event, `#${section.id}`)}>{section.title}</a>
                  </li>
                ))}
              </ol>
            ) : null}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function GuideBlocks({ blocks, entryKey, onLinkClick }) {
  const faqCategories = useMemo(
    () => defaultCategories.slice().sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name)),
    []
  );

  return blocks.map((block, index) => {
    const key = `${entryKey}-${index}`;
    if (block.type === "subheading") {
      return <h5 key={key} id={block.id}><InlineText text={block.text} onLinkClick={onLinkClick} /></h5>;
    }
    if (block.type === "list") {
      const ListTag = block.ordered ? "ol" : "ul";
      return (
        <ListTag key={key}>
          {block.items.map((item, itemIndex) => (
            <li key={`${key}-${itemIndex}`}><InlineText text={item} onLinkClick={onLinkClick} /></li>
          ))}
        </ListTag>
      );
    }
    if (block.type === "image") {
      return (
        <figure key={key} className={`faq-figure is-${block.kind}`}>
          <a className="faq-image-link" href={block.href} target="_blank" rel="noreferrer">
            <img src={block.src} alt={block.alt} loading="lazy" decoding="async" />
          </a>
          <figcaption>{block.alt}</figcaption>
        </figure>
      );
    }
    if (block.type === "callout") {
      return <p key={key} className="faq-callout"><InlineText text={block.text} onLinkClick={onLinkClick} /></p>;
    }
    if (block.type === "code") {
      return <pre key={key} className="faq-code"><code>{block.text}</code></pre>;
    }
    if (block.type === "categories") {
      return (
        <div key={key} className="faq-category-grid">
          {faqCategories.map((category) => (
            <div key={category.id} className="faq-category-row">
              <span
                className="category-icon category-icon-static faq-category-icon"
                style={{ "--category-color": category.colorHex }}
              >
                <CategoryGlyph iconKey={category.iconKey} />
              </span>
              <div className="faq-category-copy">
                <strong>{category.name}</strong>
                <p>{messages.common.triplet(category.iconKey, category.colorHex, category.slug)}</p>
              </div>
            </div>
          ))}
        </div>
      );
    }
    return <p key={key}><InlineText text={block.text} onLinkClick={onLinkClick} /></p>;
  });
}

function InlineText({ text, onLinkClick }) {
  return tokenizeInline(text).map((token, index) => {
    if (token.type === "code") return <code key={index}>{token.text}</code>;
    if (token.type === "bold") return <strong key={index}>{token.text}</strong>;
    if (token.type === "link") {
      const isExternal = /^https?:\/\//.test(token.href);
      return (
        <a
          key={index}
          href={token.href}
          target={isExternal ? "_blank" : undefined}
          rel={isExternal ? "noreferrer" : undefined}
          onClick={(event) => onLinkClick(event, token.href)}
        >
          {token.text}
        </a>
      );
    }
    return token.text;
  });
}
