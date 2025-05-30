import {writable, derived} from "svelte/store"
import {Zapper} from "@welshman/util"
import {
  identity,
  fetchJson,
  uniq,
  bech32ToHex,
  hexToBech32,
  tryCatch,
  batcher,
  postJson,
} from "@welshman/lib"
import {collection} from "@welshman/store"
import {deriveProfile} from "./profiles.js"
import {appContext} from "./context.js"

export const zappers = writable<Zapper[]>([])

export const fetchZappers = async (lnurls: string[]) => {
  const base = appContext.dufflepudUrl
  const zappersByLnurl = new Map<string, Zapper>()

  // Use dufflepud if we it's set up to protect user privacy, otherwise fetch directly
  if (base) {
    const hexUrls = lnurls.map(lnurl => tryCatch(() => bech32ToHex(lnurl))).filter(identity)

    if (hexUrls.length > 0) {
      const res: any = await tryCatch(
        async () => await postJson(`${base}/zapper/info`, {lnurls: hexUrls}),
      )

      for (const {lnurl, info} of res?.data || []) {
        tryCatch(() => zappersByLnurl.set(hexToBech32("lnurl", lnurl), info))
      }
    }
  } else {
    const results = await Promise.all(
      lnurls.map(async lnurl => {
        const hexUrl = tryCatch(() => bech32ToHex(lnurl))
        const info = hexUrl ? await tryCatch(async () => await fetchJson(hexUrl)) : undefined

        return {lnurl, hexUrl, info}
      }),
    )

    for (const {lnurl, info} of results) {
      if (info) {
        zappersByLnurl.set(lnurl, info)
      }
    }
  }

  return zappersByLnurl
}

export const {
  indexStore: zappersByLnurl,
  deriveItem: deriveZapper,
  loadItem: loadZapper,
  onItem: onZapper,
} = collection({
  name: "zappers",
  store: zappers,
  getKey: (zapper: Zapper) => zapper.lnurl,
  load: batcher(800, async (lnurls: string[]) => {
    const fresh = await fetchZappers(uniq(lnurls))
    const stale = zappersByLnurl.get()

    for (const lnurl of lnurls) {
      const newZapper = fresh.get(lnurl)

      if (newZapper) {
        stale.set(lnurl, {...newZapper, lnurl})
      }
    }

    zappers.set(Array.from(stale.values()))

    return lnurls
  }),
})

export const deriveZapperForPubkey = (pubkey: string, relays: string[] = []) =>
  derived([zappersByLnurl, deriveProfile(pubkey, relays)], ([$zappersByLnurl, $profile]) => {
    if (!$profile?.lnurl) {
      return undefined
    }

    loadZapper($profile.lnurl)

    return $zappersByLnurl.get($profile.lnurl)
  })
