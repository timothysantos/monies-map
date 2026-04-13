import { useMemo } from "react";
import { messages } from "./copy/en-SG";
import { CategoryGlyph } from "./ui-components";
import { categories as defaultCategories } from "../domain/demo-data";
import faqMarkdown from "../../docs/faq.md?raw";

export function FaqPanel({ viewLabel }) {
  const sections = useMemo(() => parseFaqMarkdown(faqMarkdown), []);
  const faqCategories = useMemo(
    () => defaultCategories.slice().sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name)),
    []
  );

  return (
    <article className="panel">
      <div className="panel-head">
        <div>
          <h2>{messages.tabs.faq}</h2>
          <span className="panel-context">{messages.faq.viewing(viewLabel)}</span>
        </div>
      </div>
      <div className="faq-list">
        {sections.map((section) => (
          <article key={section.title} className="faq-item">
            <h3>{section.title}</h3>
            {section.title === "What are the default app categories?" ? (
              <div className="faq-category-grid">
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
            ) : (
              section.blocks.map((block, index) => (
                block.type === "list" ? (
                  <ul key={`${section.title}-${index}`}>
                    {block.items.map((item) => (
                      <li key={item}>{renderInlineMarkdown(item)}</li>
                    ))}
                  </ul>
                ) : (
                  <p key={`${section.title}-${index}`}>{renderInlineMarkdown(block.text)}</p>
                )
              ))
            )}
          </article>
        ))}
      </div>
    </article>
  );
}

function parseFaqMarkdown(markdown) {
  const lines = markdown.split("\n");
  const sections = [];
  let currentSection = null;
  let paragraphLines = [];
  let listItems = [];

  function flushParagraph() {
    if (!currentSection || !paragraphLines.length) {
      return;
    }
    currentSection.blocks.push({ type: "paragraph", text: paragraphLines.join(" ").trim() });
    paragraphLines = [];
  }

  function flushList() {
    if (!currentSection || !listItems.length) {
      return;
    }
    currentSection.blocks.push({ type: "list", items: [...listItems] });
    listItems = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line === "# FAQ") {
      flushParagraph();
      flushList();
      continue;
    }

    if (line.startsWith("## ")) {
      flushParagraph();
      flushList();
      currentSection = { title: line.slice(3).trim(), blocks: [] };
      sections.push(currentSection);
      continue;
    }

    if (line.startsWith("- ")) {
      flushParagraph();
      listItems.push(line.slice(2).trim());
      continue;
    }

    flushList();
    paragraphLines.push(line);
  }

  flushParagraph();
  flushList();
  return sections;
}

function renderInlineMarkdown(text) {
  const segments = [];
  // FAQ content uses a tiny Markdown subset so product copy can stay in docs/faq.md.
  const pattern = /`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g;
  let lastIndex = 0;
  let match = pattern.exec(text);

  while (match) {
    if (match.index > lastIndex) {
      segments.push(text.slice(lastIndex, match.index));
    }
    if (match[1]) {
      segments.push(<code key={`${match.index}-code`}>{match[1]}</code>);
    } else {
      segments.push(
        <a key={`${match.index}-link`} href={match[3]}>
          {match[2]}
        </a>
      );
    }
    lastIndex = pattern.lastIndex;
    match = pattern.exec(text);
  }

  if (lastIndex < text.length) {
    segments.push(text.slice(lastIndex));
  }

  return segments;
}
