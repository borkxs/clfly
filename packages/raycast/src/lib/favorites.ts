import { LocalStorage } from "@raycast/api";
import type { FormValues } from "./model";

/** A pinned command: one route with its params and form values. */
export interface Favorite {
  id: string;
  title: string;
  tree: string;
  path: string[];
  params: Record<string, string>;
  values: FormValues;
}

const KEY = "favorites";

export async function loadFavorites(): Promise<Favorite[]> {
  const raw = await LocalStorage.getItem<string>(KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Favorite[];
  } catch {
    return [];
  }
}

async function save(list: Favorite[]): Promise<void> {
  await LocalStorage.setItem(KEY, JSON.stringify(list));
}

/** Same tree + path + params + values replaces the old entry instead of duplicating it. */
export async function addFavorite(fav: Omit<Favorite, "id">): Promise<Favorite> {
  const list = await loadFavorites();
  const id = JSON.stringify([fav.tree, fav.path, fav.params, fav.values]);
  const entry = { ...fav, id };
  await save([entry, ...list.filter((f) => f.id !== id)]);
  return entry;
}

export async function removeFavorite(id: string): Promise<void> {
  await save((await loadFavorites()).filter((f) => f.id !== id));
}
