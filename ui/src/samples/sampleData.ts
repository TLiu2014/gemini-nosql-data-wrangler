/**
 * Read-only previews of what `sample_mflix` looks like, so the user can see
 * the schema in the Results panel before any query has run. These are NOT
 * inserted into the database — the live data lives in Atlas already and we
 * read it through the MongoDB MCP server.
 *
 * If/when we wire up the "Upload JSON" path, that path will write user-supplied
 * documents to a temp collection; this file stays untouched.
 */

export const SAMPLE_MFLIX_EMBEDDED_MOVIES: Array<Record<string, unknown>> = [
  {
    _id: "573a1396f29313caabce582d",
    title: "The Three Musketeers",
    year: 1973,
    genres: ["Action", "Adventure", "Comedy"],
    plot: "A young swordsman comes to Paris and faces villains, romance, adventure and intrigue with three Musketeer friends.",
    runtime: 106,
    cast: ["Oliver Reed", "Raquel Welch", "Richard Chamberlain", "Michael York"],
    imdb: { rating: 7.3, votes: 11502 },
    plot_embedding: "<binData 1536-dim plot vector>",
  },
  {
    _id: "573a13a6f29313caabd13d24",
    title: "Inception",
    year: 2010,
    genres: ["Action", "Adventure", "Sci-Fi"],
    plot: "A thief who steals corporate secrets through the use of dream-sharing technology is given the inverse task of planting an idea into the mind of a CEO.",
    runtime: 148,
    cast: ["Leonardo DiCaprio", "Joseph Gordon-Levitt", "Ellen Page"],
    imdb: { rating: 8.8, votes: 1992045 },
    plot_embedding: "<binData 1536-dim plot vector>",
  },
  {
    _id: "573a13aaf29313caabd1d8a3",
    title: "Mad Max: Fury Road",
    year: 2015,
    genres: ["Action", "Adventure", "Sci-Fi"],
    plot: "In a post-apocalyptic wasteland, a woman rebels against a tyrannical ruler in search for her homeland with the help of a group of female prisoners, a psychotic worshiper, and a drifter named Max.",
    runtime: 120,
    cast: ["Tom Hardy", "Charlize Theron", "Nicholas Hoult"],
    imdb: { rating: 8.1, votes: 858213 },
    plot_embedding: "<binData 1536-dim plot vector>",
  },
];
