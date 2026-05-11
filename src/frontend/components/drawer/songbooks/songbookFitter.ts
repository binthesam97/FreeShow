import { get } from "svelte/store"
import type { Resolution, Styles } from "../../../../types/Settings"
import type { Item, Template } from "../../../../types/Show"
import { activeStyle, outputs, styles, templates } from "../../../stores"
import autosize from "../../edit/scripts/autosize"
import { clone } from "../../helpers/array"
import { DEFAULT_BOUNDS, getFirstActiveOutput, getOutputResolution, percentageStylePos } from "../../helpers/output"
import { getStyles } from "../../helpers/style"
import type { SongVerse } from "./songbooks"

const SONGBOOK_MAX_ROWS = 4
const SONGBOOK_SIDE_BY_SIDE_MAX_ROWS = 8
const SONGBOOK_KEYS = ["songbook_text", "songbook1_text", "songbook2_text"] as const
const LABEL_KEY = "songbook_label"

type SongbookLayoutMode = "single" | "stacked" | "side-by-side"

type SongbookDynamicKey = (typeof SONGBOOK_KEYS)[number] | typeof LABEL_KEY

export interface SongbookFooterData {
    songBookName?: string
    songNumber?: string | number
}

export interface SongbookFitContext {
    templateId: string
    template: Template
    styleId: string
    currentStyle: Styles
    resolution: Resolution
    hasTransliteration: boolean
    layoutMode: SongbookLayoutMode
    lyricBoxes: SongbookTextBox[]
    labelItem: Item | null
    footerData: SongbookFooterData
}

export interface SongbookFitSlide {
    label: string
    baseLabel: string
    verseType: string
    dynamicValues: { [key: string]: string }
    items: Item[]
    hasTransliteration: boolean
}

export interface SongbookFitResult {
    context: SongbookFitContext
    slides: SongbookFitSlide[]
}

interface SongbookTextBox {
    key: SongbookDynamicKey
    templateItem: Item
    lineTemplate: NonNullable<Item["lines"]>[number]
    baseFontSize: number
    fontFloor: number
    maxRows: number
}

interface SongLinePair {
    original: string
    transliteration: string
}

interface FittedChunk {
    pairs: SongLinePair[]
    fontSizes: Partial<Record<SongbookDynamicKey, number>>
}

interface MeasurementResult {
    fontSize: number
    fitsBox: boolean
    withinRowCap: boolean
    withinFloor: boolean
}

let measureRoot: HTMLElement | null = null

export function fitSongbookSlides(verses: SongVerse[], transliterationVerses: SongVerse[], withTransliteration: boolean, footerData: SongbookFooterData = {}): SongbookFitResult {
    const context = resolveSongbookFitContext(withTransliteration, footerData)
    const sortedOriginal = [...verses].sort((a, b) => a.order - b.order)
    const sortedTransliteration = [...transliterationVerses].sort((a, b) => a.order - b.order)

    const slides: SongbookFitSlide[] = []

    sortedOriginal.forEach((verse, index) => {
        const transliterationVerse = withTransliteration ? sortedTransliteration[index] : undefined
        const baseLabel = getVerseLabel(verse)
        const versePairs = createLinePairs(verse.content, transliterationVerse?.content || "")
        const fittedChunks = fitPairsRecursive(versePairs, context)
        const totalChunks = fittedChunks.length

        fittedChunks.forEach((chunk, chunkIndex) => {
            const label = totalChunks > 1 ? `${baseLabel} (${chunkIndex + 1}/${totalChunks})` : baseLabel
            const dynamicValues = createDynamicValues(chunk.pairs, label, context.footerData)

            slides.push({
                label,
                baseLabel,
                verseType: verse.type || "verse",
                dynamicValues,
                items: buildDisplayItems(context, chunk, dynamicValues),
                hasTransliteration: withTransliteration
            })
        })
    })

    return { context, slides }
}

function resolveSongbookFitContext(hasTransliteration: boolean, footerData: SongbookFooterData): SongbookFitContext {
    const outputsState = get(outputs)
    const stylesState = get(styles)
    const activeOutput = getFirstActiveOutput(outputsState)
    const fallbackStyleId = get(activeStyle) || (stylesState.default ? "default" : Object.keys(stylesState)[0] || "")
    const styleId = activeOutput?.style || fallbackStyleId
    const currentStyle: Styles = stylesState[styleId] || { name: "" }
    const translations = hasTransliteration ? 2 : 1
    const translationKey = translations > 1 ? `_${translations}` : ""
    const selectedTemplateId = (currentStyle[`templateSongbook${translationKey}` as keyof Styles] as string) || currentStyle.templateSongbook || `songbook${translationKey}`
    let templateId = get(templates)[selectedTemplateId] ? selectedTemplateId : hasTransliteration ? "songbook_2" : "songbook"
    let template = clone(get(templates)[templateId]) || { name: "", color: null, category: "songbook", items: [] }
    const resolution = activeOutput ? getOutputResolution(activeOutput.id, outputsState, true, styleId) : { ...DEFAULT_BOUNDS }

    let parsed = parseTemplateItems(template)
    if (!parsed.lyricBoxes.length) {
        templateId = hasTransliteration ? "songbook_2" : "songbook"
        template = clone(get(templates)[templateId]) || template
        parsed = parseTemplateItems(template)
    }

    const layoutMode = getSongbookLayoutMode(parsed.lyricBoxes)
    const lyricBoxes = applyLayoutConstraints(parsed.lyricBoxes, layoutMode)
    const { labelItem } = parsed

    return {
        templateId,
        template,
        styleId,
        currentStyle,
        resolution,
        hasTransliteration,
        layoutMode,
        lyricBoxes,
        labelItem,
        footerData
    }
}

function parseTemplateItems(template: Template) {
    const lyricBoxes: SongbookTextBox[] = []
    let labelItem: Item | null = null

    template.items.forEach((item) => {
        if ((item.type || "text") !== "text" || !item.lines?.length) return

        const key = getSongbookPlaceholderKey(item)
        if (!key) return

        if (key === LABEL_KEY) {
            if (!labelItem) labelItem = clone(item)
            return
        }

        if (lyricBoxes.some((box) => box.key === key)) return

        const lineTemplate = clone(item.lines[0])
        const textStyle = lineTemplate?.text?.find((text) => !!text.value)?.style || ""
        const baseFontSize = Number(getStyles(textStyle, true)["font-size"] || "") || 100

        lyricBoxes.push({
            key,
            templateItem: clone(item),
            lineTemplate,
            baseFontSize,
            fontFloor: Math.max(32, baseFontSize * 0.7),
            maxRows: SONGBOOK_MAX_ROWS
        })
    })

    return { lyricBoxes, labelItem }
}

function getSongbookLayoutMode(lyricBoxes: SongbookTextBox[]): SongbookLayoutMode {
    if (lyricBoxes.length <= 1) return "single"

    const [firstBox, secondBox] = lyricBoxes
    const firstPos = getItemPosition(firstBox.templateItem)
    const secondPos = getItemPosition(secondBox.templateItem)

    const leftDelta = Math.abs(firstPos.left - secondPos.left)
    const topDelta = Math.abs(firstPos.top - secondPos.top)

    return leftDelta > topDelta ? "side-by-side" : "stacked"
}

function applyLayoutConstraints(lyricBoxes: SongbookTextBox[], layoutMode: SongbookLayoutMode) {
    return lyricBoxes.map((box) => {
        if (layoutMode === "single") {
            return {
                ...box,
                maxRows: Number.POSITIVE_INFINITY,
                fontFloor: Math.max(14, box.baseFontSize * 0.22)
            }
        }

        if (layoutMode === "side-by-side") {
            return {
                ...box,
                maxRows: SONGBOOK_SIDE_BY_SIDE_MAX_ROWS
            }
        }

        return {
            ...box,
            maxRows: SONGBOOK_MAX_ROWS
        }
    })
}

function getItemPosition(item: Item) {
    const itemStyle = getStyles(item.style || "", true)
    return {
        top: Number(itemStyle.top || 0),
        left: Number(itemStyle.left || 0)
    }
}

function fitPairsRecursive(pairs: SongLinePair[], context: SongbookFitContext): FittedChunk[] {
    const dynamicValues = createDynamicValues(pairs, "", context.footerData)
    const measurement = measureChunk(context, dynamicValues)
    const fitsSafely = measurement.every((entry) => entry.fitsBox && entry.withinRowCap && entry.withinFloor)

    if (fitsSafely) {
        return [{ pairs, fontSizes: toFontSizeMap(context, measurement) }]
    }

    if (pairs.length > 1) {
        const splitIndex = Math.ceil(pairs.length / 2)
        const firstHalf = pairs.slice(0, splitIndex)
        const secondHalf = pairs.slice(splitIndex)
        return [...fitPairsRecursive(firstHalf, context), ...fitPairsRecursive(secondHalf, context)]
    }

    const splitPairs = splitSinglePair(pairs[0])
    if (splitPairs.length > 1) {
        return splitPairs.flatMap((pair) => fitPairsRecursive([pair], context))
    }

    const usableMeasurements = measurement.filter((entry) => entry.fitsBox && entry.withinRowCap)
    return [
        {
            pairs,
            fontSizes: toFontSizeMap(context, usableMeasurements.length ? usableMeasurements : measurement)
        }
    ]
}

function buildDisplayItems(context: SongbookFitContext, chunk: FittedChunk, dynamicValues: { [key: string]: string }): Item[] {
    const items: Item[] = []

    context.lyricBoxes.forEach((box) => {
        const value = dynamicValues[box.key] || ""
        const fittedFontSize = chunk.fontSizes[box.key]
        const lineValues = value ? value.split("\n") : [""]
        const item = clone(box.templateItem)
        const lineTemplate = clone(box.lineTemplate)
        const textTemplate = clone(lineTemplate.text?.[0] || { value: "", style: "" })

        if (context.hasTransliteration) {
            item.style = removeBorderStyles(item.style || "")
        }

        if (box.key === "songbook_text" || box.key === "songbook1_text") {
            item.style = (item.style || "") + "; margin: -8px !important;"
            lineTemplate.align = (lineTemplate.align || "") + "; line-height: 1.4 !important;"
        }

        item.lines = lineValues.map((lineValue) => ({
            align: lineTemplate.align || "",
            text: [{ ...textTemplate, value: lineValue }]
        }))

        if (typeof fittedFontSize === "number" && isFinite(fittedFontSize)) {
            item.autoFontSize = fittedFontSize
            item.previewAutoFontSize = fittedFontSize
        }

        items.push(item)
    })

    if (context.labelItem?.lines?.length) {
        const labelItem = clone(context.labelItem)
        const lineTemplate = clone(labelItem.lines[0])
        const textTemplate = clone(lineTemplate.text?.[0] || { value: "", style: "" })
        labelItem.auto = true
        labelItem.textFit = labelItem.textFit && labelItem.textFit !== "none" ? labelItem.textFit : "shrinkToFit"
        labelItem.lines = [
            {
                align: lineTemplate.align || "",
                text: [{ ...textTemplate, value: dynamicValues[LABEL_KEY] || "" }]
            }
        ]
        items.push(labelItem)
    }

    return items
}

function measureChunk(context: SongbookFitContext, dynamicValues: { [key: string]: string }): MeasurementResult[] {
    return context.lyricBoxes.map((box) => measureTextBox(box, dynamicValues[box.key] || "", context.resolution))
}

function measureTextBox(box: SongbookTextBox, value: string, resolution: Resolution): MeasurementResult {
    if (!value.trim()) {
        return {
            fontSize: box.baseFontSize,
            fitsBox: true,
            withinRowCap: true,
            withinFloor: box.baseFontSize >= box.fontFloor
        }
    }

    const { outer, align, spans, breaks } = createMeasureBox(box, value, resolution)
    const textFit = box.templateItem.textFit || (box.templateItem.auto ? "shrinkToFit" : "none")

    let fontSize = box.baseFontSize
    try {
        fontSize = autosize(align, {
            type: textFit,
            textQuery: ".lines .break span",
            defaultFontSize: box.baseFontSize,
            minFontSize: 1
        })
    } catch (error) {
        console.error("Songbook fit autosize failed", error)
    }

    spans.forEach((span) => span.style.setProperty("font-size", `${fontSize}px`, "important"))

    const fitsBox = align.scrollHeight <= align.clientHeight + 1 && align.scrollWidth <= align.clientWidth + 1
    const rowCount = breaks.reduce((total, entry) => {
        const rectCount = entry.span.textContent?.length ? entry.span.getClientRects().length : 0
        return total + Math.max(entry.empty ? 1 : 0, rectCount || estimateRows(entry.breakElem, fontSize))
    }, 0)

    outer.remove()

    return {
        fontSize,
        fitsBox,
        withinRowCap: rowCount <= box.maxRows,
        withinFloor: fontSize >= box.fontFloor
    }
}

function createMeasureBox(box: SongbookTextBox, value: string, resolution: Resolution) {
    const root = getMeasureRoot()
    const outer = document.createElement("div")
    outer.setAttribute("style", `${percentageStylePos(box.templateItem.style || "", resolution)}position:absolute;left:-20000px;top:0;opacity:0;pointer-events:none;overflow:hidden;box-sizing:border-box;`)

    const align = document.createElement("div")
    align.className = "align"
    align.setAttribute("style", `height:100%;display:flex;text-align:center;align-items:center;${box.templateItem.align || ""}`)

    const lines = document.createElement("div")
    lines.className = "lines"
    lines.setAttribute("style", "width:100%;display:flex;flex-direction:column;text-align:center;justify-content:center;")

    const spans: HTMLSpanElement[] = []
    const breaks: { breakElem: HTMLDivElement; span: HTMLSpanElement; empty: boolean }[] = []
    const lineValues = value.split("\n")

    lineValues.forEach((lineValue) => {
        const breakElem = document.createElement("div")
        const normalWrap = shouldUseNormalWrap(box.lineTemplate)
        breakElem.className = `break${normalWrap ? " normalWrap" : ""}`
        breakElem.setAttribute("style", `${box.lineTemplate.align || ""}width:100%;font-size:0;overflow-wrap:break-word;${normalWrap ? "text-wrap:unset;" : "text-wrap:balance;"}`)

        const span = document.createElement("span")
        span.className = "textContainer"
        span.setAttribute("style", box.lineTemplate.text?.[0]?.style || "")

        const empty = !lineValue.length
        if (empty) span.innerHTML = "<br>"
        else span.textContent = lineValue

        breakElem.appendChild(span)
        lines.appendChild(breakElem)
        spans.push(span)
        breaks.push({ breakElem, span, empty })
    })

    align.appendChild(lines)
    outer.appendChild(align)
    root.appendChild(outer)

    return { outer, align, spans, breaks }
}

function getMeasureRoot() {
    if (measureRoot && document.body.contains(measureRoot)) return measureRoot

    measureRoot = document.createElement("div")
    measureRoot.id = "songbook-fit-measure-root"
    measureRoot.setAttribute("style", "position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;pointer-events:none;z-index:-1;")
    document.body.appendChild(measureRoot)
    return measureRoot
}

function estimateRows(elem: HTMLElement, fontSize: number) {
    if (!elem.textContent?.trim().length) return 1

    const computed = window.getComputedStyle(elem)
    const lineHeightValue = computed.lineHeight
    const lineHeight = lineHeightValue === "normal" ? fontSize * 1.2 : parseFloat(lineHeightValue) || fontSize * 1.2
    const estimated = elem.getBoundingClientRect().height / Math.max(lineHeight, 1)
    return Math.max(1, Math.round(estimated))
}

function createLinePairs(originalContent: string, transliterationContent: string): SongLinePair[] {
    const originalLines = splitSemanticLines(originalContent)
    const transliterationLines = splitSemanticLines(transliterationContent)
    const length = Math.max(originalLines.length, transliterationLines.length)

    if (!length) return [{ original: "", transliteration: "" }]

    const pairs: SongLinePair[] = []
    for (let index = 0; index < length; index++) {
        const original = originalLines[index] || ""
        const transliteration = transliterationLines[index] || ""
        if (!original.trim() && !transliteration.trim()) continue
        pairs.push({ original, transliteration })
    }

    return pairs.length ? pairs : [{ original: "", transliteration: "" }]
}

function splitSemanticLines(content: string) {
    return (content || "")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length)
}

function splitSinglePair(pair: SongLinePair) {
    const originalParts = splitBalancedText(pair.original)
    const transliterationParts = splitBalancedText(pair.transliteration)
    const length = Math.max(originalParts.length, transliterationParts.length)

    if (length <= 1) return [pair]

    const pairs: SongLinePair[] = []
    for (let index = 0; index < length; index++) {
        const original = originalParts[index] || ""
        const transliteration = transliterationParts[index] || ""
        if (!original.trim() && !transliteration.trim()) continue
        pairs.push({ original, transliteration })
    }

    return pairs.length ? pairs : [pair]
}

function splitBalancedText(value: string) {
    const trimmed = value.trim()
    if (!trimmed.length) return [""]

    const wordParts = trimmed.match(/\S+\s*/g) || []
    if (wordParts.length > 1) {
        const midpoint = Math.ceil(wordParts.length / 2)
        return [wordParts.slice(0, midpoint).join("").trim(), wordParts.slice(midpoint).join("").trim()].filter(Boolean)
    }

    const characters = Array.from(trimmed)
    if (characters.length > 1) {
        const midpoint = Math.ceil(characters.length / 2)
        return [characters.slice(0, midpoint).join("").trim(), characters.slice(midpoint).join("").trim()].filter(Boolean)
    }

    return [trimmed]
}

function createDynamicValues(pairs: SongLinePair[], label: string, footerData: SongbookFooterData = {}) {
    const original = pairs.map((pair) => pair.original).join("\n")
    const transliteration = pairs.map((pair) => pair.transliteration).join("\n")
    const footerLabel = buildFooterLabel(label, footerData)

    return {
        songbook_text: original,
        songbook1_text: original,
        songbook2_text: transliteration,
        songbook_label: footerLabel
    }
}

function buildFooterLabel(label: string, footerData: SongbookFooterData) {
    const bookName = footerData.songBookName?.trim() || ""
    const songNumber = `${footerData.songNumber ?? ""}`.trim()
    const footerParts = [bookName, songNumber].filter(Boolean)

    if (!footerParts.length) return label
    if (!label) return footerParts.join(" ")

    return `${label} • ${footerParts.join(" ")}`
}

function toFontSizeMap(context: SongbookFitContext, measurements: MeasurementResult[]) {
    return measurements.reduce(
        (result, measurement, index) => {
            const key = context.lyricBoxes[index]?.key
            if (key) result[key] = measurement.fontSize
            return result
        },
        {} as Partial<Record<SongbookDynamicKey, number>>
    )
}

function getSongbookPlaceholderKey(item: Item): SongbookDynamicKey | null {
    for (const line of item.lines || []) {
        for (const text of line.text || []) {
            for (const key of [LABEL_KEY, ...SONGBOOK_KEYS]) {
                if (text.value?.includes(`{${key}}`)) return key
            }
        }
    }

    return null
}

function shouldUseNormalWrap(lineTemplate: NonNullable<Item["lines"]>[number]) {
    return !!(lineTemplate.align?.includes("justify") || lineTemplate.align?.includes("left") || JSON.stringify(lineTemplate).includes("nowrap"))
}

function removeBorderStyles(style: string) {
    if (!style) return style

    return style
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean)
        .filter((part) => {
            const [property] = part.split(":")
            const key = property?.trim().toLowerCase() || ""
            if (key === "border") return false
            if (key.startsWith("border-") && !key.startsWith("border-radius")) return false
            return true
        })
        .join(";")
        .concat(";")
}

function getVerseLabel(verse: SongVerse): string {
    const type = verse.type?.toLowerCase() || "verse"
    if (type === "chorus") return "Chorus"
    if (type === "bridge") return "Bridge"
    const num = verse.displayNumber || verse.order
    return `Verse ${num}`
}
