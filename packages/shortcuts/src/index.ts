/**
 * @steward/shortcuts: builds, checks and signs the iPhone shortcuts Steward hands out
 * (docs/plans/phone-and-shortcuts.md §4.5). A TypeScript port of Tempo's builder, with Perspective
 * Cuts' `actions.json` (MIT) as reference data for action identifiers.
 */
export {
  type Action,
  act,
  attachment,
  Builder,
  Condition,
  fields,
  newId,
  output,
  REPEAT_ITEM,
  resetIds,
  SHORTCUT_INPUT,
  type Token,
  text,
  variable,
} from "./builder.ts";
export { type PlistDict, PlistError, type PlistValue, parsePlist, toXmlPlist } from "./plist.ts";
export {
  isSigned,
  type ShortcutsRunner,
  SigningError,
  type SigningProblem,
  type SignMode,
  type SignOptions,
  shortcutHeaders,
  sign,
} from "./sign.ts";
export { readSigned, SIGNED_DIR, type SignedManifest } from "./signed.ts";
export {
  buildLauncher,
  buildStewardShortcut,
  PAIR_URL_PATTERN,
  previewSteps,
  SHORTCUT_NAME,
  STORAGE_PATH,
  type StewardShortcutOptions,
  VERSION_HEADER,
  type Workflow,
} from "./steward.ts";
export { EXTRA_ACTIONS, knownActions, type Validation, validate } from "./validate.ts";
