import {describe, it, vi, expect, beforeEach} from "vitest"
import {GENERIC_REPOST, LONG_FORM, MUTES, REPOST} from "@welshman/util"
import {
  addRepostFilters,
  getFilterGenerality,
  getFilterId,
  getFilterResultCardinality,
  getIdFilters,
  getReplyFilters,
  guessFilterDelta,
  intersectFilters,
  matchFilter,
  matchFilters,
  trimFilter,
  unionFilters,
  Filter,
} from "../src/Filters"
import type {TrustedEvent} from "../src/Events"

describe("Filters", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const pubkey = "000000789abcdef0000000789abcdef0000000789abcdef0000000789abcdef"
  const id = "ff".repeat(32)
  const currentTime = Math.floor(Date.now() / 1000)

  const createEvent = (overrides = {}): TrustedEvent => ({
    id: id,
    pubkey: pubkey,
    created_at: currentTime,
    kind: 1,
    tags: [],
    content: "Hello Nostr!",
    ...overrides,
  })

  describe("matchFilter", () => {
    it("should match basic filter criteria", () => {
      const event = createEvent()
      const filter = {kinds: [1], authors: [pubkey]}
      expect(matchFilter(filter, event)).toBe(true)
    })

    it("should handle search terms", () => {
      const event = createEvent({content: "Hello Nostr World!"})
      expect(matchFilter({search: "nostr"}, event)).toBe(true)
      expect(matchFilter({search: "bitcoin"}, event)).toBe(false)
    })

    it("should handle multiple search terms", () => {
      const event = createEvent({content: "Hello Nostr World!"})
      expect(matchFilter({search: "hello world"}, event)).toBe(true)
    })

    it("should handle case-insensitive search", () => {
      const event = createEvent({content: "Hello NOSTR World!"})
      expect(matchFilter({search: "nostr"}, event)).toBe(true)
    })
  })

  describe("matchFilters", () => {
    it("should match if any filter matches", () => {
      const event = createEvent()
      const filters = [{kinds: [2]}, {kinds: [1], authors: [pubkey]}]
      expect(matchFilters(filters, event)).toBe(true)
    })

    it("should not match if no filters match", () => {
      const event = createEvent()
      const filters = [{kinds: [2]}, {kinds: [3]}]
      expect(matchFilters(filters, event)).toBe(false)
    })
  })

  describe("getFilterId", () => {
    it("should generate consistent IDs for equivalent filters", () => {
      const filter1 = {kinds: [1], authors: [pubkey]}
      const filter2 = {authors: [pubkey], kinds: [1]}
      expect(getFilterId(filter1)).toBe(getFilterId(filter2))
    })

    it("should generate different IDs for different filters", () => {
      const filter1 = {kinds: [1], authors: [pubkey]}
      const filter2 = {kinds: [2], authors: [pubkey]}
      expect(getFilterId(filter1)).not.toBe(getFilterId(filter2))
    })
  })

  describe("unionFilters", () => {
    it("should combine similar filters", () => {
      const filters = [
        {kinds: [1], authors: [pubkey]},
        {kinds: [1], authors: [pubkey + "1"]},
      ]
      const result = unionFilters(filters)
      expect(result).toHaveLength(1)
      expect(result[0].authors).toHaveLength(2)
    })

    it("should handle different filter groups", () => {
      const filters: Filter[] = [{kinds: [1]}, {"#e": [id]}]
      const result = unionFilters(filters)
      expect(result).toHaveLength(2)
    })

    it("should preserve limit, since, until, and search", () => {
      const filters = [
        {kinds: [1], limit: 10, since: 1000, until: 2000, search: "test"},
        {kinds: [1], limit: 10, since: 1000, until: 2000, search: "test"},
      ]
      const result = unionFilters(filters)
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({limit: 10, since: 1000, until: 2000, search: "test"})
    })
  })

  describe("intersectFilters", () => {
    it("should combine filter groups", () => {
      const groups = [[{kinds: [1]}], [{authors: [pubkey]}]]
      const result = intersectFilters(groups)
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        kinds: [1],
        authors: [pubkey],
      })
    })

    it("should handle since, until, and limit", () => {
      const groups = [
        [{since: 1000, until: 2000, limit: 10}],
        [{since: 1500, until: 1800, limit: 20}],
      ]
      const result = intersectFilters(groups)
      expect(result[0]).toMatchObject({
        since: 1500, // Max of since
        until: 1800, // Min of until
        limit: 20, // Max of limit
      })
    })

    it("should combine search terms", () => {
      const groups = [[{search: "hello"}], [{search: "world"}]]
      const result = intersectFilters(groups)
      expect(result[0].search).toBe("hello world")
    })
  })

  describe("getIdFilters", () => {
    it("should handle plain IDs", () => {
      const result = getIdFilters([id])
      expect(result[0].ids).toContain(id)
    })

    it("should handle addresses", () => {
      const addr = `1:${pubkey}:test`
      const result = getIdFilters([addr])
      expect(result[0]).toMatchObject({
        kinds: [1],
        authors: [pubkey],
        "#d": ["test"],
      })
    })

    it("should handle mixed IDs and addresses", () => {
      const addr = `1:${pubkey}:test`
      const result = getIdFilters([id, addr])
      expect(result).toHaveLength(2)
    })
  })

  describe("getReplyFilters", () => {
    it("should create filters for regular events", () => {
      const event = createEvent()
      const result = getReplyFilters([event])
      expect((result[0] as any)["#e"]).toContain(event.id)
    })

    it("should handle replaceable events", () => {
      const event = createEvent({kind: MUTES})
      const result = getReplyFilters([event])
      expect((result[0] as any)["#a"]).toBeDefined()
    })

    it("should handle wrapped events", () => {
      const event = createEvent({
        wrap: createEvent(),
      })
      const result = getReplyFilters([event])
      expect((result[0] as any)["#e"]).toHaveLength(2)
    })
  })

  describe("addRepostFilters", () => {
    it("should add repost kinds for kind 1", () => {
      const result = addRepostFilters([{kinds: [1]}])
      expect(result).toHaveLength(2)
      expect(result[1].kinds).toContain(REPOST)
    })

    it("should handle other kinds", () => {
      const result = addRepostFilters([{kinds: [LONG_FORM]}])
      expect(result[1].kinds).toContain(GENERIC_REPOST)
      expect(result[1].kinds).not.toContain(REPOST)
      expect(result[1]["#k"]).toContain(LONG_FORM.toString())
    })
  })

  describe("filter utilities", () => {
    it("should calculate filter generality", () => {
      expect(getFilterGenerality({ids: [id]})).toBe(0)
      expect(getFilterGenerality({authors: [pubkey], "#p": [pubkey]})).toBe(0.2)
      expect(getFilterGenerality({authors: [pubkey, pubkey, pubkey], kinds: [1]})).toBe(0.01)
      expect(getFilterGenerality({kinds: [1]})).toBe(1)
    })

    it("should guess filter delta", () => {
      const result = guessFilterDelta([{ids: [id]}])
      expect(result).toBeGreaterThan(0)
    })

    it("should get filter result cardinality", () => {
      expect(getFilterResultCardinality({ids: [id, id + "1"]})).toBe(2)
      expect(getFilterResultCardinality({kinds: [1]})).toBeUndefined()
    })

    it("should trim large filters", () => {
      const largeFilter = {authors: Array(2000).fill(pubkey)}
      const result = trimFilter(largeFilter)
      expect(result.authors?.length).toBe(1000)
    })
  })
})
