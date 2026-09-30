import {
  ArrowRightLeft,
  Baby,
  BadgeDollarSign,
  Banknote,
  BanknoteArrowUp,
  BusFront,
  CarFront,
  Church,
  Clapperboard,
  Dumbbell,
  Gift,
  GraduationCap,
  HeartPulse,
  House,
  Lightbulb,
  Plane,
  Receipt,
  ShoppingBag,
  ShoppingCart,
  Shield,
  UtensilsCrossed,
  UsersRound,
  WalletCards,
  WashingMachine
} from "lucide-react";

import { CATEGORY_COLOURS, FALLBACK_CATEGORY_COLOUR } from "../domain/category-palette";

export const ICON_OPTIONS = [
  { key: "arrow-right-left", label: "Transfer", Icon: ArrowRightLeft },
  { key: "badge-dollar-sign", label: "Salary", Icon: BadgeDollarSign },
  { key: "banknote-arrow-up", label: "Extra income", Icon: BanknoteArrowUp },
  { key: "banknote", label: "Bills", Icon: Banknote },
  { key: "wallet-cards", label: "Other", Icon: WalletCards },
  { key: "utensils", label: "Food", Icon: UtensilsCrossed },
  { key: "shopping-bag", label: "Shopping", Icon: ShoppingBag },
  { key: "users", label: "Family", Icon: UsersRound },
  { key: "baby", label: "Baby", Icon: Baby },
  { key: "receipt", label: "Receipt", Icon: Receipt },
  { key: "shopping-cart", label: "Groceries", Icon: ShoppingCart },
  { key: "house", label: "Home", Icon: House },
  { key: "church", label: "Church", Icon: Church },
  { key: "plane", label: "Travel", Icon: Plane },
  { key: "dumbbell", label: "Hobbies", Icon: Dumbbell },
  { key: "lightbulb", label: "Bills", Icon: Lightbulb },
  { key: "clapperboard", label: "Entertainment", Icon: Clapperboard },
  { key: "graduation-cap", label: "Education", Icon: GraduationCap },
  { key: "shield", label: "Insurance", Icon: Shield },
  { key: "bus", label: "Transport", Icon: BusFront },
  { key: "car-front", label: "Taxi", Icon: CarFront },
  { key: "washing-machine", label: "Subscriptions", Icon: WashingMachine },
  { key: "heart-pulse", label: "Healthcare", Icon: HeartPulse },
  { key: "gift", label: "Gift", Icon: Gift }
];

export const ICON_REGISTRY = Object.fromEntries(ICON_OPTIONS.map((item) => [item.key, item.Icon]));

// The category palette lives in src/domain/category-palette.ts.
export const COLOR_OPTIONS = CATEGORY_COLOURS;

export const FALLBACK_THEME = { colorHex: FALLBACK_CATEGORY_COLOUR, iconKey: "receipt" };

export const ACCOUNT_KIND_OPTIONS = [
  { value: "bank", label: "Bank" },
  { value: "credit_card", label: "Credit card" },
  { value: "loan", label: "Loan" },
  { value: "cash", label: "Cash" },
  { value: "investment", label: "Investment" }
];
