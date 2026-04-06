export const adversarialOutputs = {
  mixedCaseFileTags: `<CHAOSPLAN>patch</CHAOSPLAN>
<FILE path='src/demo.ts'>
\`\`\`ts
export const demo = 1
\`\`\`
</FILE>`,

  mixedToolAndFile: `<chaosplan>implement the feature</chaosplan>
<tool_use name="run_check" id="check-1">{"scope":"ui"}</tool_use>
<file path="src/demo.ts">export const demo = 1</file>`,

  traversalFileTag: `<file path="../secrets.txt">leak</file>`,

  absoluteFileTag: `<file path="/etc/passwd">x</file>`,

  suspiciousSecretContent: `<file path="src/config.ts">export const key = \"anthropic_api_key=sk-ant-test-secret\"</file>`,

  reviewWithFencedFix: `<review>
<severity>minor</severity>
<issues>
- use const
</issues>
<fixed>
\`\`\`ts
export const x = 1
\`\`\`
</fixed>
</review>`,
}

