/**
 * Reference catalog of MongoDB's `sample_mflix` dataset — what collections
 * exist, roughly how big each is, and a one-line description so a presenter
 * can talk about the data without a live Atlas connection.
 *
 * Static, not fetched from Atlas. Counts are the canonical sizes from
 * MongoDB's published sample dataset (they don't change between clusters
 * unless someone has imported a customized copy).
 */

export interface MflixCollection {
  name: string;
  estimatedCount: number;
  description: string;
  /** A single representative document — kept small. The full data is in Atlas. */
  exampleDocument: unknown;
}

export const MFLIX_COLLECTIONS: MflixCollection[] = [
  {
    name: "movies",
    estimatedCount: 21349,
    description:
      "Films with title, year, genres, plot, cast, directors, runtime, ratings.",
    exampleDocument: {
      _id: "573a1390f29313caabcd4135",
      title: "Blacksmith Scene",
      year: 1893,
      genres: ["Short"],
      runtime: 1,
      cast: ["Charles Kayser", "John Ott"],
      directors: ["William K.L. Dickson"],
      plot: "Three men hammer on an anvil and pass a bottle of beer around.",
      fullplot:
        "A stationary camera looks at a large anvil with a blacksmith behind it...",
      languages: ["English"],
      released: "1893-05-09T00:00:00.000Z",
      type: "movie",
      imdb: { rating: 6.2, votes: 1189, id: 5 },
      tomatoes: { viewer: { rating: 3, numReviews: 184 }, lastUpdated: "2015-06-28" },
    },
  },
  {
    name: "embedded_movies",
    estimatedCount: 3483,
    description:
      "Subset of movies with a 1536-dim `plot_embedding` vector field. Used for $vectorSearch over plot semantics.",
    exampleDocument: {
      _id: "573a1390f29313caabcd6e8e",
      title: "The Great Train Robbery",
      year: 1903,
      genres: ["Short", "Western"],
      plot: "A group of bandits stage a brazen train hold-up...",
      plot_embedding: [
        0.0143, -0.0271, 0.0518, "/* … 1536 floats … */", -0.0089,
      ],
      cast: ["A.C. Abadie", "Gilbert M. 'Broncho Billy' Anderson"],
      directors: ["Edwin S. Porter"],
      runtime: 11,
      imdb: { rating: 7.4, votes: 9847, id: 439 },
    },
  },
  {
    name: "comments",
    estimatedCount: 50304,
    description:
      "User comments left on movies. Joins back to `movies._id` via `movie_id`, and to `users._id` via `email`.",
    exampleDocument: {
      _id: "5a9427648b0beebeb6957a21",
      name: "Andrea Le",
      email: "andrea_le@fakegmail.com",
      movie_id: "573a1390f29313caabcd4135",
      text: "Rem officiis eaque repellendus amet eos doloribus. Porro dolor voluptatum voluptas vero...",
      date: "2012-03-26T23:20:16.000Z",
    },
  },
  {
    name: "users",
    estimatedCount: 185,
    description:
      "User accounts. The `email` field is the join key for `comments` and `sessions`.",
    exampleDocument: {
      _id: "59b99db4cfa9a34dcd7885b6",
      name: "Ned Stark",
      email: "sean_bean@gameofthron.es",
      password: "$2b$12$UREFwsRUoyF0CRqGNK0LzO0HM/jLhgUCNNIJ9RJAqMUQ74crlJ1Vu",
    },
  },
  {
    name: "theaters",
    estimatedCount: 1564,
    description:
      "AMC-style theater locations with a `location.geo` GeoJSON Point — handy for $geoNear demos.",
    exampleDocument: {
      _id: "59a47286cfa9a3a73e51e72c",
      theaterId: 1000,
      location: {
        address: {
          street1: "340 W Market",
          city: "Bloomington",
          state: "MN",
          zipcode: "55425",
        },
        geo: { type: "Point", coordinates: [-93.24565, 44.85466] },
      },
    },
  },
  {
    name: "sessions",
    estimatedCount: 1,
    description:
      "Auth/session tokens — rarely used in demos, but listed for completeness.",
    exampleDocument: {
      _id: "5b03f7d76c41ab290b0e44b3",
      user_id: "user@example.com",
      jwt: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoidXNlckBleGFtcGxlLmNvbSJ9.…",
    },
  },
];
