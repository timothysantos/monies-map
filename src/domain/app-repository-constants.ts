import { household as defaultHousehold } from "./demo-data";

// The app is currently single-household. Keep the id behind a neutral constant so runtime repositories
// do not import demo fixtures directly while the seed module still owns the reference data shape.
export const DEFAULT_HOUSEHOLD_ID = defaultHousehold.id;
