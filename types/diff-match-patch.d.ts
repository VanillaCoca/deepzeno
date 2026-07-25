// Minimal ambient declaration for the untyped `diff-match-patch` package
// (no bundled types, no @types installed). Covers only what lib/ir/redline.ts
// uses. The existing lib/editor/diff.js reaches the same library from JS, which
// TypeScript does not type-check; the TS redline module needs this.
declare module "diff-match-patch" {
  export type Diff = [number, string];

  // biome-ignore lint/style/useNamingConvention: upstream class name is snake_case.
  export class diff_match_patch {
    diff_main(text1: string, text2: string, optChecklines?: boolean): Diff[];
    diff_cleanupSemantic(diffs: Diff[]): void;
    diff_cleanupEfficiency(diffs: Diff[]): void;
  }

  export const DIFF_DELETE: -1;
  export const DIFF_INSERT: 1;
  export const DIFF_EQUAL: 0;
}
