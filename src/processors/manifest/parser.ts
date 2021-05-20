import glob from "glob";
import get from "lodash.get";
import diff from "lodash.difference";
import path from "path";

import {
    ChromeExtensionManifest,
    ContentScript,
    WebAccessibleResource,
} from "../../manifest";

export interface ManifestEntries {
    background?: string;
    content_scripts?: string[];
    options_page?: string;
    options_ui?: string;
    popup?: string;
    override?: { bookmarks?:string, history?:string, newtab?:string };
    devtools?: string;
    web_accessible_resources?: string[];
}

/* -------------------------------------------- */
/*                 DERIVE FILES                 */
/* -------------------------------------------- */

export class ManifestParser {
    public entries(manifest: ChromeExtensionManifest, srcPath: string): ManifestEntries {
        const entries: ManifestEntries = {};
        // background service worker
        const background = this.backgroundEntry(manifest, srcPath);
        background && (entries.background = background);
        // content scripts
        const content_scripts = this.contentScriptEntries(manifest, srcPath);
        content_scripts && (entries.content_scripts = content_scripts);
        // options page
        const options_page = this.optionsPageEntry(manifest, srcPath)
        options_page && (entries.options_page = options_page);
        // options ui
        const options_ui = this.optionsUiEntry(manifest, srcPath);
        options_ui && (entries.options_ui = options_ui);
        // popup
        const popup = this.popupEntry(manifest, srcPath);
        popup && (entries.popup = popup);
        // override
        const override = this.overrideEntries(manifest, srcPath);
        override && (entries.override = override);
        // TODO: standalone
        // devtools
        const devtools = this.devtoolsEntry(manifest, srcPath);
        devtools && (entries.devtools = devtools);
        // web accessible resources
        const web_accessible_resources = this.webAccessibleResourceEntries(manifest, srcPath);
        web_accessible_resources && (entries.web_accessible_resources = web_accessible_resources);
        return entries;
    }

    public backgroundEntry(manifest: ChromeExtensionManifest, srcPath: string) {
        return manifest.background ? path.resolve(srcPath, manifest.background.service_worker) : undefined;
    }

    public contentScriptEntries(manifest: ChromeExtensionManifest, srcPath: string) {
        const scripts = manifest.content_scripts?.map(script => script.js || [])
            .reduce((arr, item) => arr.concat(item), [])
            .map(script => path.resolve(srcPath, script));
        return scripts && scripts.length <= 0 ? undefined : scripts;
    }

    public optionsPageEntry(manifest: ChromeExtensionManifest, srcPath: string) {
        return manifest.options_page ? path.resolve(srcPath, manifest.options_page) : undefined;
    }

    public optionsUiEntry(manifest: ChromeExtensionManifest, srcPath: string) {
        return manifest.options_ui ? path.resolve(srcPath, manifest.options_ui.page) : undefined;
    }

    public popupEntry(manifest: ChromeExtensionManifest, srcPath: string) {
        return manifest.action?.default_popup ? path.resolve(srcPath, manifest.action.default_popup) : undefined;
    }

    public overrideEntries(manifest: ChromeExtensionManifest, srcPath: string) {
        if (!manifest.chrome_url_overrides) { return undefined; }
        const override: any = {};
        manifest.chrome_url_overrides.bookmarks && (override.bookmarks = path.resolve(srcPath, manifest.chrome_url_overrides.bookmarks));
        manifest.chrome_url_overrides.history && (override.history = path.resolve(srcPath, manifest.chrome_url_overrides.history));
        manifest.chrome_url_overrides.newtab && (override.history = path.resolve(srcPath, manifest.chrome_url_overrides.newtab));
        return Object.keys(override).length > 0 ? override : undefined;
    }

    public standaloneEntry(manifest: ChromeExtensionManifest, srcPath: string) {
        // TODO: add standalone entry parser
    }

    public devtoolsEntry(manifest: ChromeExtensionManifest, srcPath: string) {
        return manifest.devtools_page ? path.resolve(srcPath, manifest.devtools_page) : undefined;
    }

    public webAccessibleResourceEntries(manifest: ChromeExtensionManifest, srcPath: string) {
        const resources = manifest.web_accessible_resources?.map(resource => resource.resources)
            .reduce((arr, item) => arr.concat(item), [])
            .map(resource => path.resolve(srcPath, resource));
        return resources && resources.length <= 0 ? undefined : resources;
    }
}

export function deriveFiles(
    manifest: ChromeExtensionManifest,
    srcDir: string,
) {
    // get resources from section web_accessible_resources
    const web_accessible_resources = get(
        manifest,
        "web_accessible_resources",
        [] as WebAccessibleResource[],
    ).reduce((resource_paths, web_accessible_resource) =>
        web_accessible_resource.resources.reduce((r, x) => {
            if (glob.hasMagic(x)) {
                const files = glob.sync(x, { cwd: srcDir });
                return [...r, ...files.map((f) => f.replace(srcDir, ""))];
            } else {
                return [...r, x];
            }
        }, resource_paths),
    [] as string[]);

    /**
     * js files come from:
     *  - web_accessible_resources
     *  - background.service_worker
     *  - content_scripts
     */
    const js = [
        ...web_accessible_resources.filter((f: string) => /\.[jt]sx?$/.test(f)),
        get(manifest, "background.service_worker"),
        ...get(
            manifest,
            "content_scripts",
            [] as ContentScript[],
        ).reduce((r, { js = [] }) => [...r, ...js], [] as string[]),
    ];

    /**
     * html files come from:
     *  - web_accessible_resources
     *  - options_page
     *  - options_ui.page
     *  - devtools_page
     *  - action.default_popup
     *  - chrome_url_overrides
     */
    const html = [
        ...web_accessible_resources.filter((f: string) => /\.html?$/.test(f)),
        get(manifest, "options_page"),
        get(manifest, "options_ui.page"),
        get(manifest, "devtools_page"),
        get(manifest, "action.default_popup"),
        ...Object.values(get(manifest, "chrome_url_overrides", {})),
    ];

    /**
     * css files come from:
     *  - web_accessible_resources
     *  - content_scripts
     */
    const css = [
        ...web_accessible_resources.filter((f: string) => f.endsWith(".css")),
        ...get(
            manifest,
            "content_scripts",
            [] as ContentScript[],
        ).reduce(
            (r, { css = [] }) => [...r, ...css],
            [] as string[],
        ),
    ];

    /**
     * action icons come from:
     *  - web_accessible_resources
     *  - content_scripts
     */
    const actionIconSet = new Set<string>();
    const default_icons: string | { [size: string]: string } = get(
        manifest,
        "action.default_icon",
        {} as any,
    );
    if (typeof default_icons === "string") {
        actionIconSet.add(default_icons);
    } else {
        Object.values(default_icons).forEach((x) => actionIconSet.add(x));
    }

    /**
     * image files come from:
     *  - web_accessible_resources
     *  - action.default_icon
     *  - icons
     */
    const img = [
        ...actionIconSet,
        ...web_accessible_resources.filter((f) =>
            /\.(jpe?g|png|svg|tiff?|gif|webp|bmp|ico)$/i.test(f),
        ),
        ...Object.values(get(manifest, "icons", {})),
    ];

    // Files like fonts, things that are not expected
    const others = diff(web_accessible_resources, css, js, html, img);

    return {
        css: validate(css),
        js: validate(js),
        html: validate(html),
        img: validate(img),
        others: validate(others),
    };

    function validate(ary: any[]) {
        return [...new Set(ary.filter(isString))].map((x) =>
            path.join(srcDir, x),
        );
    }

    function isString(x: any): x is string {
        return typeof x === "string";
    }
}