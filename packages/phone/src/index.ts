/**
 * @steward/phone: the phone catalogue (docs/plans/phone-and-shortcuts.md §4.3), built from a
 * person's profile, and the tenant's `shortcuts.yaml`.
 */
export {
  briefAutomation,
  buildCatalogue,
  humanise,
  type PhoneProfile,
  type TenantShortcut,
} from "./catalogue.ts";
export { loadTenantShortcuts, TenantShortcutsError } from "./tenant.ts";
