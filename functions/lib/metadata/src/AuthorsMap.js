/**
 * Class that helps keep track of authors and allows for easy conversion to list format when
 * generating the final Metadata file.
 *
 * @export
 * @class AuthorsMap
 * @typedef {AuthorsMap}
 */
export class AuthorsMap {
    /**
     * Creates an empty instance of authors map. Doesn't generate default metadata because
     * can't assume anything about the authors.
     *
     * @constructor
     */
    constructor() {
        this.authors = {};
    }
    /**
     * Returns the final list format of the authors according to Psych-DS standards.
     *
     * @returns {(AuthorFields | string)[]} - List of authors
     */
    getList() {
        const author_list = [];
        for (const key of Object.keys(this.authors)) {
            author_list.push(this.authors[key]);
        }
        return author_list;
    }
    /**
     * Method that creates an author. This method can also be used to overwrite existing authors
     * with the same name in order to update fields.
     *
     * @param {AuthorFields | string} author - All the required or possible fields associated with listing an author according to Psych-DS standards. Option as a string to define an author according only to name.
     */
    setAuthor(author) {
        // Handling string input
        if (typeof author === "string") {
            this.authors[author] = author;
            return;
        }
        if (!author.name) {
            console.warn("Name field is missing. Author not added.");
            return;
        }
        const { name, ...rest } = author;
        if (Object.keys(rest).length == 0) {
            this.authors[name] = name;
        }
        else {
            const newAuthor = { name, ...rest };
            this.authors[name] = newAuthor;
            const unexpectedFields = Object.keys(author).filter((key) => !["type", "name", "givenName", "familyName", "identifier"].includes(key));
            if (unexpectedFields.length > 0) {
                console.warn(`Unexpected fields (${unexpectedFields.join(", ")}) detected and included in the author object.`);
            }
        }
    }
    /**
     * Method that fetches an author object allowing user to update (in existing workflow should not be necessary).
     *
     * @param {string} name - Name of author to be used as key.
     * @returns {(AuthorFields | string | {})} - Object with author information. Empty object if not found.
     */
    getAuthor(name) {
        if (name in this.authors) {
            return this.authors[name];
        }
        else {
            console.warn("Author (", name, ") not found.");
            return {};
        }
    }
}
//# sourceMappingURL=AuthorsMap.js.map