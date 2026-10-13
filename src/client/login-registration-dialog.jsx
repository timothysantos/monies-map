import { UserRound } from "lucide-react";
import { useState } from "react";

import { PickerRow } from "./detail-field-rows";
import { SheetDialog } from "./sheet-dialog";
import { DetailRow, DetailRows, LeadCard, MetaChip } from "./ui-components";
import { useIsMobileLayout } from "./use-viewport";

// Asks an unlinked login which household profile it belongs to. Modal
// because it interrupts only when the shell has no identity mapping, so it
// cannot be closed: there is no close button, and Escape, a tap outside and a
// swipe do nothing until the login is saved. App, the identity owner, keeps
// the draft, the submit handler and the rule for which name a chosen profile
// suggests. The lead is the login (its email), the two choices are Detail rows
// and Save login is the one action.
export function LoginRegistrationDialog({ draft, people, error, isSubmitting, onSubmit, onPersonChange, onNameChange }) {
  const isSheet = useIsMobileLayout();
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const person = people.find((item) => item.id === draft.personId);
  const description = `Link ${draft.email} to one household profile. This lets Splits open on your view next time.`;

  return (
    <SheetDialog
      dismissible={false}
      className="login-registration-dialog"
      title="Set up this login"
      description={description}
      descriptionHidden
      lead={(
        <LeadCard
          className="sheet-dialog-lead"
          category={{ icon: UserRound }}
          title={draft.email}
          chips={person ? <MetaChip person={person.name}>{person.name}</MetaChip> : null}
        >
          <p className="lsd-note">{description}</p>
        </LeadCard>
      )}
      errorMessage={error}
      primaryLabel={isSubmitting ? "Saving..." : "Save login"}
      primaryDisabled={isSubmitting}
      onSubmit={() => onSubmit({ preventDefault() {} })}
      onClose={() => {}}
    >
      <DetailRows label="Login details">
        <PickerRow
          isSheet={isSheet}
          rowKey="profile"
          label="Household profile"
          valueLabel={person?.name ?? ""}
          value={draft.personId}
          options={people.map((item) => ({ value: item.id, label: item.name }))}
          onValueChange={onPersonChange}
          open={isPickerOpen}
          onOpenChange={setIsPickerOpen}
        />
        <DetailRow label="Display name">
          <input
            value={draft.name}
            placeholder="Name for this household profile"
            enterKeyHint="done"
            onChange={(event) => onNameChange(event.target.value)}
          />
        </DetailRow>
      </DetailRows>
    </SheetDialog>
  );
}
