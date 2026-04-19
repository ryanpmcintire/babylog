export type BookSearchResult = {
  title: string;
  author?: string;
  coverUrl?: string;
  openLibraryKey: string;
};

type OpenLibraryDoc = {
  key: string;
  title: string;
  author_name?: string[];
  cover_i?: number;
};

export async function searchBooks(
  query: string,
  signal?: AbortSignal,
): Promise<BookSearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const url = new URL("https://openlibrary.org/search.json");
  url.searchParams.set("q", q);
  url.searchParams.set("limit", "10");
  url.searchParams.set("fields", "key,title,author_name,cover_i");

  const res = await fetch(url.toString(), { signal });
  if (!res.ok) throw new Error(`Open Library ${res.status}`);
  const data = (await res.json()) as { docs: OpenLibraryDoc[] };
  return data.docs.map((d) => ({
    title: d.title,
    author: d.author_name?.[0],
    coverUrl: d.cover_i
      ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg`
      : undefined,
    openLibraryKey: d.key,
  }));
}
