import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";

import React from "react";
import * as allIcons from "react-icons";
import decamelize from "decamelize";
import * as mkdirp from "mkdirp";
import { renderToStaticMarkup } from "react-dom/server";
import * as cheerio from "cheerio";
import ora, { spinners } from "ora";

type IconInfo = {
  name: string;
  projectUrl: string;
  license: string;
  licenseUrl: string;
  components: string[];
  elements: string[];
};

/**
 * Constants
 */
const DECAMELIZE_OPTS = {
  separator: "-",
};

const STRING_BEFORE_NUMBER_REGX = /([a-zA-Z])(\d)/;
const DEVMODE = process.env.DEVMODE;

const IconSet: Set<[elementName: string, elementContent: string]> = new Set();
const IconInfo: Record<string, IconInfo> = {};
const IconList: Set<{ id: string; label: string }> = new Set();

/**
 * Path, template, etc
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(__dirname, "dist");
mkdirp.sync(distPath);

// Template
const templatePath = path.resolve(__dirname, "templates");
const customElementTemplate = fs.readFileSync(path.join(templatePath, "custom-element.html"), "utf8");

const metaPath = path.resolve(distPath, "meta");
mkdirp.sync(metaPath);

// Public
const publicPath = path.resolve(__dirname, "public");

/**
 * Runtime
 */
const spinner = ora({
  spinner: {
    interval: 80,
    frames: spinners.dots.frames,
  },
}).start();

/**
 * Functions, misc
 */
const writeCustomElement = async (iconName: string, content: string) => {
  const iconPath = path.join(distPath, `${iconName}.html`);
  await fs.promises.writeFile(iconPath, content);
};

const cleanupSVG = (content: string) => {
  if (!content) return "";

  try {
    const $ = cheerio.load(content);
    const svg = $("svg");
    svg.removeAttr("width");
    svg.removeAttr("height");
    return svg.prop("outerHTML");
  } catch (err) {
    console.error("error", content, err);
  }
};

const buildCustomElements = async () => {
  //@ts-expect-error
  const iconManifest = allIcons.IconsManifest;
  const iconManifestLength = !DEVMODE ? iconManifest.length : 1;
  for (let { id, ...info } of iconManifest.sort((a, z) => a.id.localeCompare(z.id)).slice(0, iconManifestLength)) {
    const importPath = `react-icons/${id}`;
    const icons = await import(importPath);
    if (!icons) continue;

    const iconEntries = Object.entries(icons);
    const iconEntriesLength = !DEVMODE ? iconEntries.length : 10;
    const iconList = iconEntries.reduce((acc, [componentName]) => {
      if (componentName === "default") return acc;
      return [...acc, [componentName, decamelize(componentName.replace(STRING_BEFORE_NUMBER_REGX, "$1-$2"), DECAMELIZE_OPTS)]];
    }, []);

    IconInfo[id] = {
      ...info,
      components: iconList.map(([componentName]) => componentName),
      elements: iconList.map(([, elementName]) => elementName),
    };
    IconList.add({ id, label: info.name });

    for (const [iconName, elementName] of iconList.slice(0, iconEntriesLength)) {
      const IconComponent = await import(importPath).then((module) => module[iconName]);

      const svgIcon = cleanupSVG(await renderToStaticMarkup(<IconComponent />));
      spinner.text = `Icon \`${iconName}\` rendered.`;
      spinner.render();

      const elementContent = customElementTemplate.replace("$name", elementName).replace("$svg", svgIcon);
      IconSet.add([elementName, elementContent]);
    }
  }

  try {
    const iconArray = Array.from(IconSet).sort(([a], [z]) => a.localeCompare(z));
    const sliceArray = !DEVMODE ? iconArray.length : 10;
    await Promise.allSettled(
      iconArray.slice(0, sliceArray).map(
        async ([elementName, elementContent]) =>
          await writeCustomElement(elementName, elementContent).then(() => {
            spinner.text = `Icon \`${elementName}\` written.`;
            spinner.render();
          })
      )
    );
    spinner.stopAndPersist({
      symbol: "✅",
      text: "All 🦄 unicons elements are written.",
    });
  } catch (err) {
    console.error(err);
  }
};

const copyIconMeta = async () => {
  try {
    for (const [iconId, icons] of Object.entries(IconInfo)) {
      await fs.promises.writeFile(path.join(metaPath, `icon-${iconId}.json`), JSON.stringify(icons));
    }

    if (!DEVMODE) {
      await fs.promises.writeFile(path.join(metaPath, "icon-list.json"), JSON.stringify(Array.from(IconList)));
    }

    spinner.stopAndPersist({
      symbol: "✅",
      text: "Required JSON data are copied!",
    });
  } catch (err) {
    console.error(err);
  }
};

const copyPublicDir = async () => {
  const publicFiles = fs.readdirSync(publicPath);

  try {
    for await (const file of publicFiles) {
      const filePath = path.join(publicPath, file);
      const distFilePath = path.join(distPath, file);
      fs.cpSync(filePath, distFilePath, { recursive: true });
      spinner.text = `File \`${file}\` copied.`;
      spinner.render();
    }
    spinner.stopAndPersist({
      symbol: "✅",
      text: "All public files are copied!",
    });
  } catch (err) {
    console.error(err);
  }
};

// Start the build
await buildCustomElements();
await copyIconMeta();
await copyPublicDir();
