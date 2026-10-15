/** @jsxImportSource fullbleed/ui */
import { Document, Paragraph, Strong, Heading, Stack, Row, LayoutGrid, Image, Link,
  StyleSheet, component, type Child } from 'fullbleed/ui';

const Label = component(({ value, children }: { value: string; children?: Child }) =>
  <Paragraph><Strong>{value}</Strong>{children}</Paragraph>);
const Page = () => <Document title="Report" styles={new StyleSheet({ '@page': { size: 'A4' } })}>
  <Heading level={1}>Report</Heading>
  <Stack gap="12pt"><Label value="Total">{0}</Label>{false}{[<Paragraph key="a">One</Paragraph>]}</Stack>
  <Row wrap={false} justify="space-between"><Paragraph>Left</Paragraph><Paragraph>Right</Paragraph></Row>
  <LayoutGrid columns={2}><Image src="asset:logo" alt="Brand" /><Link href="https://example.com">Site</Link></LayoutGrid>
  <><p data-amount={0} aria-hidden={false}>Intrinsic tags remain available</p></>
</Document>;
const result: Child = <Page />;
void result;
// @ts-expect-error Custom component props remain checked.
const missing = <Label />;
// @ts-expect-error Custom prop type remains checked.
const bad = <Label value={123} />;
// @ts-expect-error Heading levels are constrained.
const level = <Heading level={7}>Invalid</Heading>;
// @ts-expect-error Explicit image alt text is required, including an empty string for decoration.
const alt = <Image src="asset:logo" />;
// @ts-expect-error Row wrapping is a boolean, not CSS text.
const wrap = <Row wrap="wrap" />;
// @ts-expect-error Async components are not static document components.
const Async = <AsyncComponent />;
async function AsyncComponent() { return <Paragraph>Async</Paragraph>; }
// @ts-expect-error Object representations cannot become text.
const object = <Paragraph>{{ customer: 'Alice' }}</Paragraph>;
void [missing, bad, level, alt, wrap, Async, object];
