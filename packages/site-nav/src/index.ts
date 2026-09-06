export interface NavLink {
  href: string;
  label: string;
}

/** Cross-app links shared by the quiz, stories, and reviews sites. */
export const APP_LINKS: NavLink[] = [
  { href: "https://melody-mind.de/", label: "Music" },
  { href: "https://quiz.melody-mind.de/", label: "Quiz" },
  { href: "https://stories.melody-mind.de/", label: "Stories" },
  { href: "https://reviews.melody-mind.de/", label: "Reviews" },
];

/** Central legal pages hosted on the main domain. */
export const LEGAL_LINKS: NavLink[] = [
  { href: "https://melody-mind.de/imprint/", label: "Imprint" },
  { href: "https://melody-mind.de/privacy/", label: "Privacy" },
  { href: "https://melody-mind.de/cookies/", label: "Cookies & storage" },
];
