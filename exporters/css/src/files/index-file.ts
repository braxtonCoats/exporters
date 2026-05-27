import { FileHelper, FileNameHelper, ThemeHelper } from "@supernovaio/export-utils"
import { OutputTextFile, Token, TokenTheme } from "@supernovaio/sdk-exporters"
import { exportConfiguration } from ".."
import { getStyleFileName } from "../utils/file-utils"
import { FileStructure, OutputFormat } from "../../config"

/**
 * Generates index file(s) that import all token style files and theme variations.
 *
 * When `outputFormat` is "both", this returns one CSS index file and one SCSS index file.
 * Pass an explicit `format` argument to generate only one index file format.
 *
 * CSS index uses:   @import "./base/color.css";
 * SCSS index uses:  @import "./base/color.scss";
 *
 * @param tokens - Array of design tokens to process
 * @param themes - Array of token themes or theme names to include
 * @param format - Explicit output format override (defaults to exportConfiguration.outputFormat)
 * @returns Array of OutputTextFile objects (0–2 entries depending on format)
 */
export function indexOutputFiles(
  tokens: Array<Token>,
  themes: Array<TokenTheme | string> = [],
  format?: OutputFormat
): Array<OutputTextFile | null> {
  const resolvedFormat = format ?? (exportConfiguration.outputFormat as OutputFormat)

  if (resolvedFormat === OutputFormat.Both) {
    return [
      ...indexOutputFiles(tokens, themes, OutputFormat.CSS),
      ...indexOutputFiles(tokens, themes, OutputFormat.SCSS),
    ]
  }

  return [indexOutputFile(tokens, themes, resolvedFormat)]
}

/**
 * Generates a single index file for the specified format.
 *
 * @param tokens - Array of design tokens to process
 * @param themes - Array of token themes or theme names to include
 * @param format - Output format for this index file
 * @returns OutputTextFile containing the index file, or null if generation is disabled
 */
export function indexOutputFile(
  tokens: Array<Token>,
  themes: Array<TokenTheme | string> = [],
  format: OutputFormat = OutputFormat.CSS
): OutputTextFile | null {
  // Skip if index file generation is disabled in configuration
  if (!exportConfiguration.generateIndexFile) {
    return null
  }

  const isScss = format === OutputFormat.SCSS
  const extension = isScss ? '.scss' : '.css'

  // =========================================
  // Single File Mode
  // =========================================
  if (exportConfiguration.fileStructure === FileStructure.SingleFile) {
    // Generate import for base tokens file (tokens.css / tokens.scss)
    const baseImport = exportConfiguration.exportBaseValues
      ? `/* Base tokens */\n@import "./tokens${extension}";`
      : ''

    // Generate imports for theme files (tokens.{theme}.css / tokens.{theme}.scss)
    const themeImports = themes.map((theme) => {
      const themePath = ThemeHelper.getThemeIdentifier(theme)
      const themeName = ThemeHelper.getThemeName(theme)
      return `/* Theme: ${themeName} */\n@import "./tokens.${themePath}${extension}";`
    }).join("\n\n")

    const separator = baseImport && themeImports ? "\n\n" : ""
    const fileName = FileNameHelper.ensureFileExtension(exportConfiguration.indexFileName, extension)

    return FileHelper.createTextFile({
      relativePath: exportConfiguration.baseIndexFilePath,
      fileName: fileName,
      content: baseImport + separator + themeImports,
    })
  }

  // =========================================
  // Separate by Type Mode
  // =========================================

  // Get all unique token types
  const types = [...new Set(tokens.map((token) => token.tokenType))]

  // Generate imports for base token files (./base/color.css, ./base/color.scss, …)
  const imports = exportConfiguration.exportBaseValues
    ? `/* Base tokens */\n` + types
        .map((type) => `@import "${exportConfiguration.baseStyleFilePath}/${getStyleFileName(type, extension)}";`)
        .join("\n")
    : ''

  // Generate imports for themed token files
  const themeImports = themes.map((theme) => {
    const themePath = ThemeHelper.getThemeIdentifier(theme)
    const themeName = ThemeHelper.getThemeName(theme)

    // When exportOnlyThemedTokens is true, include only types that have themed values
    const themeTypes = exportConfiguration.exportOnlyThemedTokens && typeof theme !== 'string'
      ? types.filter(type => ThemeHelper.hasThemedTokens(tokens, type, theme))
      : types

    return themeTypes
      .map((type, index) => {
        const themeComment = index === 0 ? `/* Theme: ${themeName} */\n` : ''
        return `${themeComment}@import "./${themePath}/${getStyleFileName(type, extension)}";`
      })
      .join("\n")
  }).join("\n\n")

  const separator = imports && themeImports ? "\n\n" : ""

  // Use the configured index file name with the correct extension
  const fileName = FileNameHelper.ensureFileExtension(exportConfiguration.indexFileName, extension)

  return FileHelper.createTextFile({
    relativePath: exportConfiguration.baseIndexFilePath,
    fileName: fileName,
    content: imports + separator + themeImports,
  })
}
