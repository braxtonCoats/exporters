import { FileHelper, ThemeHelper, FileNameHelper, GeneralHelper } from "@supernovaio/export-utils"
import { OutputTextFile, Token, TokenGroup, TokenType } from "@supernovaio/sdk-exporters"
import { exportConfiguration } from ".."
import { convertedToken, analyzeTokensForRgbUtilities } from "../content/token"
import { TokenTheme } from "@supernovaio/sdk-exporters"
import { FileStructure, OutputFormat } from "../../config"
import { DesignSystemCollection } from "@supernovaio/sdk-exporters/build/sdk-typescript/src/model/base/SDKDesignSystemCollection"

/**
 * Main entry point for generating style files.
 *
 * When `outputFormat` is "both", this function generates CSS and SCSS files in a single call.
 * Pass an explicit `format` argument (CSS or SCSS) to generate only one format — this is used
 * internally by the recursive "both" path.
 *
 * @param tokens - Array of all available tokens
 * @param tokenGroups - Array of token groups for reference
 * @param themePath - Optional path for theme-specific files
 * @param theme - Optional theme configuration for themed tokens
 * @param tokenCollections - Array of token collections for reference
 * @param format - Explicit output format override (defaults to exportConfiguration.outputFormat)
 * @returns Array of OutputTextFile objects
 */
export function generateStyleFiles(
  tokens: Array<Token>,
  tokenGroups: Array<TokenGroup>,
  themePath: string = '',
  theme?: TokenTheme,
  tokenCollections: Array<DesignSystemCollection> = [],
  format?: OutputFormat
): Array<OutputTextFile> {
  // Resolve format from config when not explicitly provided
  const resolvedFormat = format ?? (exportConfiguration.outputFormat as OutputFormat)

  // When "both", generate CSS and SCSS files by recursing once per format
  if (resolvedFormat === OutputFormat.Both) {
    return [
      ...generateStyleFiles(tokens, tokenGroups, themePath, theme, tokenCollections, OutputFormat.CSS),
      ...generateStyleFiles(tokens, tokenGroups, themePath, theme, tokenCollections, OutputFormat.SCSS),
    ]
  }

  // Skip generating base token files if exportBaseValues is disabled and this isn't a theme file
  if (!exportConfiguration.exportBaseValues && !themePath) {
    return []
  }

  // For single file output
  if (exportConfiguration.fileStructure === FileStructure.SingleFile) {
    const result = generateCombinedStyleFile(tokens, tokenGroups, themePath, theme, tokenCollections, resolvedFormat)
    return result ? [result] : []
  }

  // For separate files by type (default)
  const types = [...new Set(tokens.map(token => token.tokenType))]
  return types
    .map(type => styleOutputFile(type, tokens, tokenGroups, themePath, theme, tokenCollections, resolvedFormat))
    .filter((file): file is OutputTextFile => file !== null)
}

/**
 * Generates a CSS or SCSS output file for a specific token type.
 *
 * CSS output wraps variables in a selector block:
 *   :root {
 *     --color-primary: #0052cc;
 *   }
 *
 * SCSS output emits bare variables (no selector):
 *   $color-primary: #0052cc !default;
 *
 * @param type - The type of tokens to generate styles for (colors, typography, etc.)
 * @param tokens - Array of all available tokens
 * @param tokenGroups - Array of token groups for reference
 * @param themePath - Optional path for theme-specific files (e.g. 'dark', 'light')
 * @param theme - Optional theme configuration for themed tokens
 * @param tokenCollections - Array of token collections for reference
 * @param format - Output format: CSS custom properties or SCSS variables
 * @returns OutputTextFile object if file should be generated, null otherwise
 */
export function styleOutputFile(
  type: TokenType,
  tokens: Array<Token>,
  tokenGroups: Array<TokenGroup>,
  themePath: string = '',
  theme?: TokenTheme,
  tokenCollections: Array<DesignSystemCollection> = [],
  format: OutputFormat = OutputFormat.CSS
): OutputTextFile | null {
  // Skip generating base token files if exportBaseValues is disabled and this isn't a theme file
  if (!exportConfiguration.exportBaseValues && !themePath) {
    return null
  }

  const isScss = format === OutputFormat.SCSS

  // Get all tokens matching the specified token type
  let tokensOfType = tokens.filter((token) => token.tokenType === type)

  // For theme files: filter tokens to only include those that are themed
  if (themePath && theme && exportConfiguration.exportOnlyThemedTokens) {
    tokensOfType = ThemeHelper.filterThemedTokens(tokensOfType, theme)

    // Skip generating theme file if no tokens are themed for this type
    if (tokensOfType.length === 0) {
      return null
    }
  }

  // Skip generating file if there are no tokens and empty files are disabled
  if (!exportConfiguration.generateEmptyFiles && tokensOfType.length === 0) {
    return null
  }

  // Create a map of all tokens by ID for reference resolution
  const mappedTokens = new Map(tokens.map((token) => [token.id, token]))

  // Analyze tokens to identify which color tokens need RGB utilities (CSS only)
  const colorTokensNeedingRgb = isScss
    ? new Set<string>()
    : analyzeTokensForRgbUtilities(tokens, tokenGroups, tokenCollections)

  // Convert tokens to variable declarations for the target format
  const tokenDeclarations = tokensOfType
    .map((token) => convertedToken(token, mappedTokens, tokenGroups, tokenCollections, colorTokensNeedingRgb, format))
    .join("\n")

  let content: string

  if (isScss) {
    // SCSS: variables are top-level, no selector wrapper needed
    content = tokenDeclarations
  } else {
    // CSS: wrap variable declarations in the appropriate selector block
    const selector = themePath
      ? exportConfiguration.themeSelector.replace('{theme}', themePath)
      : exportConfiguration.cssSelector
    content = `${selector} {\n${tokenDeclarations}\n}`
  }

  // Optionally prepend the generated-file disclaimer
  if (exportConfiguration.showGeneratedFileDisclaimer) {
    content = GeneralHelper.addDisclaimer(exportConfiguration.disclaimer, content)
  }

  // Determine the output directory path
  const relativePath = themePath
    ? `./${themePath}`
    : exportConfiguration.baseStyleFilePath

  // Resolve the file name and apply the correct extension
  const extension = isScss ? '.scss' : '.css'
  let fileName = exportConfiguration.customizeStyleFileNames
    ? exportConfiguration.styleFileNames[type]
    : FileNameHelper.getDefaultStyleFileName(type)

  // Strip any existing extension then apply the target one
  fileName = fileName.replace(/\.(css|scss)$/i, '') + extension

  return FileHelper.createTextFile({
    relativePath: relativePath,
    fileName: fileName,
    content: content,
  })
}

/**
 * Generates a single combined CSS or SCSS file containing all token types.
 *
 * @param tokens - Array of all available tokens
 * @param tokenGroups - Array of token groups for reference
 * @param themePath - Optional path for theme-specific files
 * @param theme - Optional theme configuration for themed tokens
 * @param tokenCollections - Array of token collections for reference
 * @param format - Output format: CSS custom properties or SCSS variables
 * @returns OutputTextFile object if file should be generated, null otherwise
 */
function generateCombinedStyleFile(
  tokens: Array<Token>,
  tokenGroups: Array<TokenGroup>,
  themePath: string = '',
  theme?: TokenTheme,
  tokenCollections: Array<DesignSystemCollection> = [],
  format: OutputFormat = OutputFormat.CSS
): OutputTextFile | null {
  const isScss = format === OutputFormat.SCSS
  let processedTokens = tokens

  // For theme files: filter tokens to only include those that are themed
  if (themePath && theme && exportConfiguration.exportOnlyThemedTokens) {
    processedTokens = ThemeHelper.filterThemedTokens(processedTokens, theme)

    if (processedTokens.length === 0) {
      return null
    }
  }

  // Skip generating file if there are no tokens and empty files are disabled
  if (!exportConfiguration.generateEmptyFiles && processedTokens.length === 0) {
    return null
  }

  // Create a map of all tokens by ID for reference resolution
  const mappedTokens = new Map(tokens.map((token) => [token.id, token]))

  // Analyze tokens to identify which color tokens need RGB utilities (CSS only)
  const colorTokensNeedingRgb = isScss
    ? new Set<string>()
    : analyzeTokensForRgbUtilities(tokens, tokenGroups, tokenCollections)

  // Convert all tokens to variable declarations for the target format
  const tokenDeclarations = processedTokens
    .map((token) => convertedToken(token, mappedTokens, tokenGroups, tokenCollections, colorTokensNeedingRgb, format))
    .join("\n")

  let content: string

  if (isScss) {
    content = tokenDeclarations
  } else {
    const selector = themePath
      ? exportConfiguration.themeSelector.replace('{theme}', themePath)
      : exportConfiguration.cssSelector
    content = `${selector} {\n${tokenDeclarations}\n}`
  }

  if (exportConfiguration.showGeneratedFileDisclaimer) {
    content = GeneralHelper.addDisclaimer(exportConfiguration.disclaimer, content)
  }

  // For single file mode: themed files go in root with theme-based names
  const extension = isScss ? '.scss' : '.css'
  const baseName = themePath ? `tokens.${themePath}` : 'tokens'
  const fileName = `${baseName}${extension}`

  return FileHelper.createTextFile({
    relativePath: './',
    fileName: fileName,
    content: content,
  })
}
