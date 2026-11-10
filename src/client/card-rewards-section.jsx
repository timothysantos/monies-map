import "./card-rewards-section.css";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { buildCardRewardsModel } from "./card-rewards-model";
import { cardRewardsCopy as copy, formatMiles } from "./copy/card-rewards-copy";
import { shortMonthName } from "./copy/subscriptions-copy";
import { money } from "./formatters";
import { useMoneyPrivacy } from "./money-privacy";
import { getPersonColourVars } from "./person-colour";
import { useCardRewards } from "./use-card-rewards";
import { useIsMobileLayout } from "./use-viewport";

// Miles and cashback (design.md "Miles and cashback"; DOMAIN.md "Card
// reward rule"): what each credit card has earned so far this month (or
// statement month), how much of each bonus cap is used, the best card now
// for the top categories, cap notices, and a look back over 3 whole months.
// Rides in Spending Mix's lazy chunk like Subscriptions and bills; its data
// is read only once the top summary is usable. No AI.
//
// Every figure is openable (design.md "Openable figures"): data-fig="spent"
// with the entry ids the server named, in the household view's amounts
// (data-fig-view: a bank pays on the whole card amount), so View entries
// lists exactly the spending behind it. A spending figure equals Entries'
// total to the cent (money-figures.ts "cardRewardSpendFigureMinor"); a miles
// figure lists the spending that earned it.

function Figure({ ids, period, name, children, className = "" }) {
  if (!ids?.length) {
    return <span className={className}>{children}</span>;
  }
  return (
    <span className={className} data-fig="spent" data-fig-ids={ids.join(" ")} data-fig-period={period} data-fig-name={name} data-fig-view="household" tabIndex={0} role="button">
      {children}
    </span>
  );
}

// Miles reveal spending like dollars do, so hidden money hides them too.
const HIDDEN = "••••";
function earnedText(unit, amount, visible) {
  if (!visible) return HIDDEN;
  return unit === "miles" ? copy.miles(amount) : money(Math.floor(amount));
}

function OwnerChip({ name }) {
  if (!name) return null;
  return <span className="cr-owner" style={getPersonColourVars(name)}>{name}</span>;
}

function BonusBar({ card, bonus }) {
  const { areTotalsVisible } = useMoneyPrivacy();
  if (!areTotalsVisible) {
    return null;
  }
  if (bonus.capMinor === null) {
    return <p className="cr-bonus-line">{copy.noCap(card.unit, bonus)}</p>;
  }
  const share = Math.min(1, bonus.usedMinor / bonus.capMinor);
  const usedUp = bonus.roomMinor === 0;
  return (
    <div className={`cr-bonus${usedUp ? " is-used-up" : ""}`} data-bonus={bonus.bonusId}>
      <div className="cr-bar" role="img" aria-label={`${Math.round(share * 100)}%`}>
        <span className="cr-bar-fill" style={{ width: `${Math.round(share * 100)}%` }} />
      </div>
      <p className="cr-bonus-line">
        <Figure ids={bonus.eligibleIds} period={bonus.period} name={copy.bonusSpending(card.name)} className="cr-figure">{money(bonus.eligibleMinor)}</Figure>
        {" "}{copy.barOf(money(bonus.capMinor))}
        {" · "}{usedUp ? copy.usedUp(bonus.resetsOn) : copy.roomLeft(money(bonus.roomMinor), bonus.resetsOn)}
      </p>
      <p className="cr-bonus-what">{copy.barFor(card.unit, bonus)}</p>
    </div>
  );
}

function CardRow({ card, showOwner }) {
  const { areTotalsVisible } = useMoneyPrivacy();
  return (
    <li className="cr-card" data-card={card.accountId}>
      <div className="cr-card-head">
        <span className="cr-card-name">
          {card.name}
          {showOwner ? <OwnerChip name={card.ownerName} /> : null}
        </span>
        <span className="cr-card-earned">
          <Figure ids={card.ids} period={card.period} name={card.unit === "miles" ? copy.milesFrom(card.name) : copy.backFrom(card.name)} className="cr-figure">
            {earnedText(card.unit, card.earned, areTotalsVisible)}
          </Figure>
          <span className="cr-label">{copy.since(card)}</span>
        </span>
      </div>
      {card.bonuses.filter((bonus) => bonus.capMinor !== null).map((bonus) => <BonusBar key={bonus.bonusId} card={card} bonus={bonus} />)}
      {card.minimum && !card.minimum.met && (card.minimum.needMinor || card.minimum.needCount) ? (
        <p className="cr-bonus-line">{copy.minimumToGo(card.minimum.needMinor ? money(card.minimum.needMinor) : "", card.minimum.needCount)}</p>
      ) : null}
    </li>
  );
}

function BestList({ best }) {
  if (!best.length) {
    return <p className="cr-quiet">{copy.nothingBest}</p>;
  }
  return (
    <ul className="cr-best">
      {best.map((row) => {
        const lead = row.miles ?? row.cashback;
        const unit = row.miles ? "miles" : "cashback";
        return (
          <li key={row.categoryName} className="cr-best-row" data-best={row.categoryName}>
            <span className="cr-best-category">{row.categoryName}</span>
            <span className="cr-best-card">
              <strong>{lead.name}</strong>
              {" · "}{copy.bestRow(unit, lead.rate)}
              {lead.needs?.length ? ` ${copy.bestNeeds(lead.needs)}` : ""}
              {lead.roomMinor !== null && lead.roomMinor !== undefined ? ` · ${copy.bestRoom(money(lead.roomMinor))}` : ""}
            </span>
            <span className="cr-best-note">
              {lead.usualName && lead.usualAccountId !== lead.accountId ? copy.bestUsual(lead.usualName) : lead.usualName ? copy.bestSame : ""}
              {row.miles && row.cashback ? `${lead.usualName ? " · " : ""}${copy.orCashback(row.cashback.name, row.cashback.rate)}` : ""}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function noticeText(notice) {
  if (notice.kind === "used_up") {
    const what = notice.channels?.length && !notice.categories?.length ? "spending" : (notice.categories?.[0] ?? "spending");
    const main = copy.usedUpNotice(notice.name, notice.resetsOn, notice.baseRate, notice.unit, what);
    return notice.alternative ? `${main} ${copy.alternative(notice.alternativeName, notice.alternative.roomMinor === null ? null : money(notice.alternative.roomMinor))}` : main;
  }
  if (notice.kind === "nearly") return copy.nearlyNotice(notice.name, money(notice.roomMinor), notice.resetsOn);
  return copy.minimumNotice(notice.name, notice.needMinor ? money(notice.needMinor) : "", notice.needCount);
}

function LookingBackBlock({ item }) {
  const { areTotalsVisible } = useMoneyPrivacy();
  const [startMonth] = item.period.split(":");
  const endMonth = item.endDate.slice(0, 7);
  const title = copy.backTitle(shortMonthName(startMonth), shortMonthName(endMonth));
  if (!item.gain) {
    return (
      <div className="cr-back" data-back={item.unit}>
        <p className="cr-section-title">{title}</p>
        <p className="cr-quiet">{copy.backNone(item.unit)}</p>
      </div>
    );
  }
  return (
    <div className="cr-back" data-back={item.unit}>
      <p className="cr-section-title">{title}</p>
      <p className="cr-back-line">
        {copy.backAbout}{" "}
        <Figure ids={item.ids} period={item.period} name={item.unit === "miles" ? copy.backMiles : copy.backCashback} className="cr-figure cr-back-figure">
          {item.unit === "miles" ? (areTotalsVisible ? copy.miles(item.gain) : HIDDEN) : money(item.gain)}
        </Figure>
        {" "}{item.unit === "miles" ? copy.backMiles : copy.backCashback}
      </p>
      <ul className="cr-changes">
        {item.changes.map((change) => (
          <li key={`${change.categoryName}|${change.fromAccountId}|${change.toAccountId}`} className="cr-change">
            <span>{copy.change(change.categoryName, change.fromName, change.toName)}</span>
            <Figure ids={change.ids} period={item.period} name={copy.change(change.categoryName, change.fromName, change.toName)} className="cr-figure cr-label">
              {item.unit === "miles" ? (areTotalsVisible ? copy.changeMiles(change.gain) : HIDDEN) : `about ${money(change.gain)} more`}
            </Figure>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Picture({ picture, pooled, phone }) {
  const { areTotalsVisible } = useMoneyPrivacy();
  const [showAll, setShowAll] = useState(false);
  const cards = phone && !showAll ? picture.phoneCards : picture.cards;
  return (
    <div className="cr-picture" data-picture={picture.personId}>
      {picture.name ? <h4 className="cr-person">{picture.name}</h4> : null}
      <div className="cr-totals">
        {picture.milesTotal ? (
          <div className="cr-total">
            <span className="cr-total-label">{copy.milesSoFar}</span>
            <Figure ids={picture.milesTotal.ids} period={picture.milesTotal.period} name={copy.milesSoFar} className="cr-total-figure">{areTotalsVisible ? formatMiles(picture.milesTotal.amount) : HIDDEN}</Figure>
          </div>
        ) : null}
        {picture.cashbackTotal ? (
          <div className="cr-total">
            <span className="cr-total-label">{copy.backSoFar}</span>
            <Figure ids={picture.cashbackTotal.ids} period={picture.cashbackTotal.period} name={copy.backSoFar} className="cr-total-figure">{money(Math.floor(picture.cashbackTotal.amount))}</Figure>
          </div>
        ) : null}
      </div>
      <ul className="cr-cards">
        {cards.map((card) => <CardRow key={card.accountId} card={card} showOwner={pooled} />)}
      </ul>
      {phone && picture.cards.length > picture.phoneCards.length ? (
        <button type="button" className="subtle-action cr-more" onClick={() => setShowAll((current) => !current)}>
          {showAll ? copy.showLess : copy.showMore}
        </button>
      ) : null}
      <p className="cr-section-title">{copy.bestTitle}</p>
      <BestList best={picture.best} />
      {picture.notices.length ? (
        <>
          <p className="cr-section-title">{copy.noticesTitle}</p>
          <ul className="cr-notices">
            {picture.notices.map((notice) => (
              <li key={`${notice.kind}|${notice.accountId}|${notice.bonusId ?? ""}`} className={`cr-notice is-${notice.kind}`}>{noticeText(notice)}</li>
            ))}
          </ul>
        </>
      ) : null}
      {picture.lookingBack.map((item) => <LookingBackBlock key={item.unit} item={item} />)}
    </div>
  );
}

/**
 * @param {{ view: any, enabled: boolean, fetchRequiredQuery: (options: any) => Promise<any> }} props
 */
export function CardRewardsSection({ view, enabled, fetchRequiredQuery }) {
  const queryClient = useQueryClient();
  const phone = useIsMobileLayout();
  const { answer } = useCardRewards({ queryClient, viewId: view.id, enabled, fetchRequiredQuery });
  const model = useMemo(() => buildCardRewardsModel(answer), [answer]);
  if (!model || model.isEmpty) {
    return null;
  }
  const pooled = model.suggestFrom === "household";
  return (
    <section className="chart-card cr-card-panel" aria-labelledby="cr-title" data-card-rewards>
      <div className="cr-head">
        <h3 id="cr-title">{copy.title}</h3>
        <span className="cr-estimate">{copy.estimate}</span>
      </div>
      <p className="cr-intro">{copy.finalWord}</p>
      {model.pictures.map((picture) => <Picture key={picture.personId} picture={picture} pooled={pooled || picture.personId === "household"} phone={phone} />)}
      {model.notSetUp ? <p className="cr-quiet">{copy.notSetUp(model.notSetUp)}</p> : null}
    </section>
  );
}

