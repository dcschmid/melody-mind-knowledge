import { getCollection, type CollectionEntry } from "astro:content";
import type { AlbumData } from "../types/album";

type AlbumCollectionEntry = CollectionEntry<"albums">;

export async function getAvailableAlbums(): Promise<AlbumData[]> {
  const collection = await getCollection(
    "albums",
    (entry: AlbumCollectionEntry) => entry.data.isAvailable
  );
  return collection.map((item: AlbumCollectionEntry) => ({
    id: item.id,
    ...item.data,
    publishedAt: item.data.publishedAt.toISOString(),
    body: item.body,
  }));
}
