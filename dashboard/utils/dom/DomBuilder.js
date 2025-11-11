/**
 * Utility class for declarative DOM element creation
 * Simplifies verbose document.createElement patterns
 */
export class DomBuilder {
  /**
   * Create a DOM element with properties and children
   * @param {string} tag - HTML tag name
   * @param {Object} props - Element properties
   * @param {Array|Element|string} children - Child elements or text
   * @returns {Element} Created DOM element
   */
  static create(tag, props = {}, children = []) {
    const el = document.createElement(tag);

    // Apply properties
    if (props.className) el.className = props.className;
    if (props.id) el.id = props.id;
    if (props.textContent !== undefined) el.textContent = props.textContent;
    if (props.innerHTML !== undefined) el.innerHTML = props.innerHTML;
    if (props.title) el.title = props.title;
    if (props.style) Object.assign(el.style, props.style);

    // Apply dataset attributes
    if (props.dataset) {
      Object.entries(props.dataset).forEach(([key, value]) => {
        el.dataset[key] = value;
      });
    }

    // Apply other attributes
    if (props.attributes) {
      Object.entries(props.attributes).forEach(([key, value]) => {
        el.setAttribute(key, value);
      });
    }

    // Add event listeners
    if (props.onClick) el.addEventListener("click", props.onClick);
    if (props.onChange) el.addEventListener("change", props.onChange);
    if (props.onInput) el.addEventListener("input", props.onInput);

    // Append children
    const childArray = Array.isArray(children) ? children : [children];
    childArray.forEach((child) => {
      if (child instanceof Element) {
        el.appendChild(child);
      } else if (typeof child === "string" || typeof child === "number") {
        el.appendChild(document.createTextNode(String(child)));
      } else if (child) {
        el.appendChild(child);
      }
    });

    return el;
  }

  // Common element shortcuts
  static div(props, children) {
    return this.create("div", props, children);
  }

  static span(props, children) {
    return this.create("span", props, children);
  }

  static p(props, children) {
    return this.create("p", props, children);
  }

  static h1(props, children) {
    return this.create("h1", props, children);
  }

  static h2(props, children) {
    return this.create("h2", props, children);
  }

  static h3(props, children) {
    return this.create("h3", props, children);
  }

  static h4(props, children) {
    return this.create("h4", props, children);
  }

  static h5(props, children) {
    return this.create("h5", props, children);
  }

  static h6(props, children) {
    return this.create("h6", props, children);
  }

  static button(props, children) {
    return this.create("button", props, children);
  }

  static input(props) {
    return this.create("input", props);
  }

  static label(props, children) {
    return this.create("label", props, children);
  }

  static table(props, children) {
    return this.create("table", props, children);
  }

  static thead(props, children) {
    return this.create("thead", props, children);
  }

  static tbody(props, children) {
    return this.create("tbody", props, children);
  }

  static tr(props, children) {
    return this.create("tr", props, children);
  }

  static th(props, children) {
    return this.create("th", props, children);
  }

  static td(props, children) {
    return this.create("td", props, children);
  }

  static ul(props, children) {
    return this.create("ul", props, children);
  }

  static li(props, children) {
    return this.create("li", props, children);
  }

  static dl(props, children) {
    return this.create("dl", props, children);
  }

  static dt(props, children) {
    return this.create("dt", props, children);
  }

  static dd(props, children) {
    return this.create("dd", props, children);
  }

  static section(props, children) {
    return this.create("section", props, children);
  }

  static article(props, children) {
    return this.create("article", props, children);
  }

  static header(props, children) {
    return this.create("header", props, children);
  }

  static footer(props, children) {
    return this.create("footer", props, children);
  }

  static a(props, children) {
    return this.create("a", props, children);
  }

  static img(props) {
    return this.create("img", props);
  }

  static strong(props, children) {
    return this.create("strong", props, children);
  }

  static em(props, children) {
    return this.create("em", props, children);
  }

  static code(props, children) {
    return this.create("code", props, children);
  }

  static pre(props, children) {
    return this.create("pre", props, children);
  }

  /**
   * Create a text node
   * @param {string} text - Text content
   * @returns {Text} Text node
   */
  static text(text) {
    return document.createTextNode(String(text));
  }

  /**
   * Create multiple elements of the same type
   * @param {string} tag - HTML tag name
   * @param {Array} items - Array of props objects
   * @returns {Array} Array of created elements
   */
  static multiple(tag, items) {
    return items.map((props) => this.create(tag, props));
  }

  /**
   * Create element only if condition is true
   * @param {boolean} condition - Whether to create the element
   * @param {Function} creator - Function that returns element
   * @returns {Element|null} Element or null
   */
  static when(condition, creator) {
    return condition ? creator() : null;
  }

  /**
   * Create a fragment containing multiple children
   * @param {Array} children - Array of elements
   * @returns {DocumentFragment} Fragment containing children
   */
  static fragment(children) {
    const fragment = document.createDocumentFragment();
    const childArray = Array.isArray(children) ? children : [children];
    childArray.forEach((child) => {
      if (child instanceof Element || child instanceof Text) {
        fragment.appendChild(child);
      } else if (typeof child === "string") {
        fragment.appendChild(document.createTextNode(child));
      }
    });
    return fragment;
  }
}
