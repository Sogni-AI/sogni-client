/** Who a changelog entry is for. */
export type ChangelogAudience = 'artist' | 'developer' | 'worker';

/**
 * The kind of change. Every entry has exactly one:
 * - `new`: something you could not do before
 * - `improved`: a change to something that already worked
 * - `fixed`: a fix
 * - `release`: a versioned release, such as a worker or SDK version
 * - `deprecated`: still works, until `effectiveAt`
 * - `removed`: no longer available
 * - `notice`: anything else you should know
 */
export type ChangelogEntryType =
  | 'new'
  | 'improved'
  | 'fixed'
  | 'release'
  | 'deprecated'
  | 'removed'
  | 'notice';

/** A page related to a changelog entry. */
export interface ChangelogLink {
  label: string;
  url: string;
}

/** One published changelog entry. Times are ISO 8601 UTC strings. */
export interface ChangelogEntry {
  /** Permanent identifier. It does not change once the entry is published. */
  id: string;
  /** The entry's page on sogni.ai. */
  url: string;
  title: string;
  /** Short summary in plain text. */
  summary: string;
  /** The full text in Markdown. */
  bodyMarkdown: string | null;
  type: ChangelogEntryType;
  audiences: ChangelogAudience[];
  /** Product ids, as listed by `changelog.products()`. */
  products: string[];
  /** The product version the change shipped in. */
  version: string | null;
  links: ChangelogLink[];
  /** `true` when you need to change something, such as for a model retirement. */
  actionRequired: boolean;
  /** When the change takes effect. For a deprecation or removal, the day the old behavior stops working. */
  effectiveAt: string | null;
  /** When the entry was published. Lists sort and filter on it. */
  publishedAt: string;
  /** When any public field of the entry last changed. */
  updatedAt: string;
}

/** A product that changelog entries can name. */
export interface ChangelogProduct {
  /** The id to use with the `product` filter. */
  id: string;
  /** Display name. */
  label: string;
  audiences: ChangelogAudience[];
}

/**
 * Filters and paging for `changelog.list()`. Every field is optional. An entry
 * must match every filter given; a filter given several values matches entries
 * that have any of them (at most 20 values per filter).
 */
export interface ListChangelogOptions {
  audience?: ChangelogAudience | ChangelogAudience[];
  /** Product ids from `changelog.products()`. */
  product?: string | string[];
  type?: ChangelogEntryType | ChangelogEntryType[];
  /**
   * Entries published at or after this time: an ISO 8601 date (`'2026-11-01'`,
   * read as midnight UTC) or a date-time with a zone (`'2026-11-01T17:00:00Z'`).
   */
  since?: string;
  /** Entries published before this time, in the same format as `since`. */
  until?: string;
  /** `true` lists only the entries you need to act on. */
  actionRequired?: boolean;
  /** Entries per page. The API defaults to 50 and returns at most 100. */
  limit?: number;
  /** The previous page's `nextCursor`. Send the same filters with it. */
  cursor?: string;
}

/** One page of changelog entries, newest first. */
export interface ListChangelogResult {
  entries: ChangelogEntry[];
  /** Pass as `cursor` to get the next page. `null` on the last page. */
  nextCursor: string | null;
}
