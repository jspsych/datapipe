// The DataPipe paper, as fields rather than as two hand-written strings.
//
// The citation page renders it three ways -- APA prose with an italic journal
// title, a plain-text APA string for the clipboard, and a BibTeX entry -- and
// a reader who copies one and reads another has to get the same paper. Typing
// the reference out once per format is how a volume number ends up correct in
// the block you can see and wrong in the block you actually pasted, with
// nothing to catch it. Everything below is derived from these fields.
export const CITATION = {
  // APA gives initials; BibTeX wants the name it can format itself, so the
  // author appears twice on purpose rather than being split at a period.
  authors: "de Leeuw, J. R.",
  authorsBibtex: "de Leeuw, Joshua R.",
  year: 2024,
  title: "DataPipe: Born-open data collection for online experiments",
  journal: "Behavior Research Methods",
  volume: 56,
  issue: 3,
  // En dash, per APA. The BibTeX entry converts it below.
  pages: "2499–2506",
  doi: "10.3758/s13428-023-02161-x",
};

export const CITATION_DOI_URL = `https://doi.org/${CITATION.doi}`;

// What the APA copy button puts on the clipboard. The rendered version on the
// page italicises the journal and links the DOI; neither survives a plain-text
// copy, so this is the same reference with that formatting dropped -- not a
// different one.
export const CITATION_APA = `${CITATION.authors} (${CITATION.year}). ${CITATION.title}. ${CITATION.journal}, ${CITATION.volume}(${CITATION.issue}), ${CITATION.pages}. ${CITATION_DOI_URL}`;

// Two BibTeX conventions applied to the fields above:
//
// - The title is wrapped in a second pair of braces. BibTeX lowercases title
//   words under most styles, and "Datapipe" in a reference list is a bug
//   report waiting to happen.
// - Page ranges take a double hyphen, which TeX renders as the en dash APA
//   already uses above.
export const CITATION_BIBTEX = `@article{deleeuw${CITATION.year}datapipe,
  title = {{${CITATION.title}}},
  author = {${CITATION.authorsBibtex}},
  journal = {${CITATION.journal}},
  year = {${CITATION.year}},
  volume = {${CITATION.volume}},
  number = {${CITATION.issue}},
  pages = {${CITATION.pages.replace(/[–—]/g, "--")}},
  doi = {${CITATION.doi}}
}`;
