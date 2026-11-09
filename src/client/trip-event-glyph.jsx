import { Cake, Car, Gift, Heart, House, Plane, Star } from "lucide-react";

// A trip or event's icon (DOMAIN.md "Trip or Event"; icon keys in
// src/domain/trip-events.ts). Plain ink: a trip's chip carries no money or
// person colour, so it never competes with the amount.
const ICONS = { plane: Plane, cake: Cake, house: House, heart: Heart, gift: Gift, car: Car, star: Star };

export function TripEventGlyph({ iconKey, size = 13 }) {
  const Icon = ICONS[iconKey] ?? Star;
  return <Icon size={size} aria-hidden="true" />;
}
