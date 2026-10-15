// SPDX-License-Identifier: MIT
/** Ordered children are captured once. Booleans and null are omitted; zero is kept.
 * DocumentArtifact is valid only at the top level (checked at runtime, including JSX).
 */
export type Child = Element | DocumentArtifact | string | number | bigint | boolean | null | undefined | Iterable<Child>;
export type Renderable = Child;
export type StyleValue = string | number | false | null | undefined | readonly (string | number | null | undefined)[];
export type StyleMap = Readonly<Record<string, StyleValue>>;
export type StyleFragment = Style | StyleMap | string | false | null | undefined | readonly StyleFragment[];
export type SheetFragment = StyleSheet | Readonly<Record<string, StyleFragment>> | string | false | null | undefined | readonly SheetFragment[];
export type AttributeValue = string | number | bigint | boolean | null | undefined;
/** Low-level attributes. Values are escaped; CSS, tag names and URLs remain developer authored. */
export type Props = Readonly<Record<string, AttributeValue | StyleFragment | Child>>;

export interface ElementProps {
  children?: Child;
  id?: string;
  className?: string;
  class_name?: string;
  class_?: string;
  class?: string;
  style?: StyleFragment;
  title?: string;
  lang?: string;
  dir?: 'ltr' | 'rtl' | 'auto';
  role?: string;
  hidden?: boolean;
  href?: string;
  src?: string;
  alt?: string;
  width?: string | number;
  height?: string | number;
  scope?: 'row' | 'col' | 'rowgroup' | 'colgroup';
  colSpan?: number;
  rowSpan?: number;
  colspan?: number;
  rowspan?: number;
  headers?: string;
  start?: number;
  value?: string | number;
  type?: string;
  htmlFor?: string;
  [name: `data-${string}`]: AttributeValue;
  [name: `data_${string}`]: AttributeValue;
  [name: `aria-${string}`]: AttributeValue;
  [name: `aria_${string}`]: AttributeValue;
}
export type ContainerTag = 'div' | 'section' | 'article' | 'aside' | 'header' | 'footer' | 'main' | 'nav';
export interface BoxProps extends ElementProps { as?: ContainerTag }
export interface StackProps extends BoxProps { gap?: string; align?: string }
export interface RowProps extends StackProps { justify?: string; wrap?: boolean }
export interface GridProps extends BoxProps { columns?: number | string; gap?: string }
export interface SectionProps extends ElementProps { heading?: Child; headingLevel?: 1 | 2 | 3 | 4 | 5 | 6 }
export interface HeadingProps extends ElementProps { level?: 1 | 2 | 3 | 4 | 5 | 6 }
export interface TextProps extends ElementProps {
  as?: 'span' | 'p' | 'strong' | 'em' | 'small' | 'b' | 'i' | 'u' | 's' | 'code' | 'pre' | 'blockquote' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
}
/** Props first, or child-first shorthand when no props are needed. */
export interface NamedComponent<P = ElementProps> {
  (props: P, ...children: Child[]): Element;
  (...children: Child[]): Element;
}
export class Element {
  readonly tag: string;
  readonly props: Readonly<Record<string, AttributeValue>>;
  readonly children: readonly Child[];
  constructor(tag: string, props?: Props, children?: Iterable<Child>);
  toHtml(): string;
}
export function el(tag: string, props: Props | null, ...children: Child[]): Element;
/** Identity helper preserving the function's parameters and result. Ordinary functions work too. */
export function component<F extends (...args: never[]) => Renderable>(fn: F): F;
export function toHtml(node: Renderable): string;
export function Fragment(props: { children?: Child; key?: string | number | bigint }): readonly Child[];
export function Fragment(...children: Child[]): readonly Child[];

export const Text: NamedComponent<TextProps>;
export const Paragraph: NamedComponent;
export const Strong: NamedComponent;
export const Emphasis: NamedComponent;
export const Header: NamedComponent;
export const Footer: NamedComponent;
export const LineBreak: (props?: Omit<ElementProps, 'children'>) => Element;
export const Link: (props: ElementProps & { href: string }, ...children: Child[]) => Element;
/** An empty alt string explicitly marks a decorative image. */
export const Image: (props: Omit<ElementProps, 'children'> & { src: string; alt: string }) => Element;
export const Heading: NamedComponent<HeadingProps>;
export const Section: NamedComponent<SectionProps>;
export const Box: NamedComponent<BoxProps>;
export const Stack: NamedComponent<StackProps>;
export const Row: NamedComponent<RowProps>;
export const LayoutGrid: NamedComponent<GridProps>;
export const Inline: NamedComponent<ElementProps & { as?: 'span' | 'div' }>;
export const Center: NamedComponent<BoxProps>;
export const Card: NamedComponent<BoxProps>;
export const Divider: (props?: Omit<ElementProps, 'children'>) => Element;
export const List: NamedComponent<ElementProps & { as?: 'ul' | 'ol' }>;
export const ListItem: NamedComponent;
export const Table: NamedComponent;
export const TableCaption: NamedComponent;
export const THead: NamedComponent;
export const TBody: NamedComponent;
export const TFoot: NamedComponent;
export const Tr: NamedComponent;
export const Th: NamedComponent;
export const Td: NamedComponent;

export interface DocumentOptions {
  children?: Child;
  title?: string;
  lang?: string;
  /** Authoring metadata only. Set actual PDF page geometry in styles or engine options. */
  page?: string;
  margin?: string;
  /** Adds a class; does not load styles. Default false. */
  bootstrap?: boolean;
  styles?: SheetFragment;
  /** Include minimal layout defaults, without loading a theme or fonts. Default true. */
  includeComponentStyles?: boolean;
}
export type RenderInput = { html: string; css?: string };
export type Renderer<O extends RenderInput, R> = ((options: O) => R) | { renderPdf(options: O): R };
export type DocumentRenderOptions<O extends RenderInput> = Omit<O, 'html' | 'css'> & { styles?: SheetFragment; html?: never; css?: never };
export class DocumentArtifact {
  readonly title: string;
  readonly lang: string;
  readonly page: string;
  readonly margin: string;
  readonly root: Element;
  readonly styles: StyleSheet;
  readonly includeComponentStyles: boolean;
  constructor(options?: DocumentOptions, children?: Iterable<Child>);
  /** HTML only: pass toCss() alongside it when calling the engine yourself. */
  toHtml(): string;
  toCss(...overrides: SheetFragment[]): string;
  renderPdf<O extends RenderInput, R>(renderer: Renderer<O, R>, options?: DocumentRenderOptions<O>): R;
}
export function Document(options: DocumentOptions, ...children: Child[]): DocumentArtifact;
export function Document(...children: Child[]): DocumentArtifact;
export const document: typeof Document;
/** Render JSX or function-composed documents through an explicit engine function, queue or browser renderer. */
export function renderDocument<O extends RenderInput, R>(node: Renderable, renderer: Renderer<O, R>, options?: DocumentRenderOptions<O>): R;
export class Style {
  constructor(...fragments: StyleFragment[]);
  merge(...fragments: StyleFragment[]): this;
  entries(): [string, string][];
  toCss(): string;
}
/** Ordered last-write-wins declarations. Map keys accept camelCase or snake_case; numbers have no implicit unit. */
export function style(...fragments: StyleFragment[]): Style;
/** Immutable snapshot of rule maps and raw CSS, in cascade order. Use raw CSS for nested at-rules. */
export class StyleSheet {
  constructor(...fragments: SheetFragment[]);
  toCss(): string;
}
export function componentStyles(): string;

export function createElement(type: string, props: Props | null, ...children: Child[]): Element;
export function createElement<P>(type: (props: P) => Renderable, props: P | null, ...children: Child[]): Renderable;
/** Scoped JSX namespace. These are static, synchronous document components, not React components or hooks. */
export namespace JSX {
  type Element = Renderable;
  type ElementType = string | ((props: never) => Renderable);
  interface ElementChildrenAttribute { children: unknown }
  interface IntrinsicAttributes { key?: string | number | bigint }
  interface IntrinsicElements { [tag: string]: ElementProps & IntrinsicAttributes }
}
