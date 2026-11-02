import React from "react";
import {render as rtlRender, screen, waitFor, within} from "@testing-library/react";
import {MemoryRouter, useLocation} from "react-router-dom";
import userEvent from "@testing-library/user-event";
import {VolumeFiles, fileOrigin} from "../VolumeFiles.jsx";
import {withEnding} from "../VolumeFileDialog.jsx";
import {deleteFile, downloadFile, filesUrl, isFileExists, listFiles, makeDirectory, readFileHead, uploadFile, uploadUrl} from "../../services/volume-files.js";
import useEventStore from "../../hooks/useEventStore.js";

vi.mock("../../services/volume-files.js", async (importOriginal) => ({
    ...(await importOriginal()),
    listFiles: vi.fn(),
    deleteFile: vi.fn(),
    uploadFile: vi.fn(),
    makeDirectory: vi.fn(),
    readFileHead: vi.fn(),
    downloadFile: vi.fn(),
}));

// The key a file is installed from is shown by the keys dialog, tested on its own.
vi.mock("../KeysSection", () => ({
    default: ({decodedObjectName, keyOnly}) => <div data-testid="key-shown">{`${keyOnly} of ${decodedObjectName}`}</div>,
}));

const Where = () => <div data-testid="where">{decodeURIComponent(useLocation().search)}</div>;
const render = (ui, {at = "/objects"} = {}) => rtlRender(<MemoryRouter initialEntries={[at]}>{ui}<Where/></MemoryRouter>);

const PATH = "ns1/vol/images";
const up = (nodes) => useEventStore.setState({
    objectInstanceStatus: {[PATH]: Object.fromEntries(Object.entries(nodes).map(([n, avail]) => [n, {avail}]))},
});

describe("VolumeFiles", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        listFiles.mockResolvedValue({items: [{name: "noble.qcow2", size: 1048576, modified_at: "2026-10-31T07:00:00Z"}], truncated: false});
        deleteFile.mockResolvedValue();
    });

    test("the address of a directory, of a file in it, of what creates one", () => {
        expect(filesUrl(PATH, "n1", undefined, {dir: "isos/old"})).toBe("/api/node/name/n1/instance/path/ns1/vol/images/file?dir=isos%2Fold");
        expect(filesUrl(PATH, "n1", "a.iso", {dir: "isos"})).toBe("/api/node/name/n1/instance/path/ns1/vol/images/file?dir=isos&name=a.iso");
        expect(filesUrl(PATH, "n1", "new", {dir: "isos", sub: "directory"})).toBe("/api/node/name/n1/instance/path/ns1/vol/images/file/directory?dir=isos&name=new");
    });

    test("the address of a file holds what it is named, encoded; replacing one, said", () => {
        expect(filesUrl(PATH, "n1", "a b.img")).toBe("/api/node/name/n1/instance/path/ns1/vol/images/file?name=a%20b.img");
        expect(filesUrl(PATH, "n1", "a.img", {replace: true})).toBe("/api/node/name/n1/instance/path/ns1/vol/images/file?name=a.img&replace=true");
        expect(isFileExists({status: 409, exists: true})).toBe(true);
        expect(isFileExists({status: 409, exists: false})).toBe(false);
        expect(isFileExists(new Error("x"))).toBe(false);
    });

    test("where a file comes from: uploaded, by whom, changed since or not; else not known", () => {
        expect(fileOrigin({name: "a", modified_at: "2026-11-02T10:00:00Z"})).toBeNull();
        // The mark set after the last byte: an upload untouched is no later than it, nanoseconds and offsets as the node writes them.
        expect(fileOrigin({name: "a", modified_at: "2026-11-02T10:00:00.1Z", uploaded_at: "2026-11-02T11:00:00.123456789+01:00", uploaded_by: "bob"}))
            .toEqual({kind: "uploaded", by: "bob", at: "2026-11-02T11:00:00.123456789+01:00", changed: false});
        expect(fileOrigin({name: "a", modified_at: "2026-11-02T10:00:01Z", uploaded_at: "2026-11-02T10:00:00Z"}).changed).toBe(true);
    });

    describe("what the services using the volume wrote", () => {
        beforeEach(() => {
            listFiles.mockResolvedValue({items: [
                {name: "noble.qcow2", size: 1, modified_at: "2026-11-02T10:00:00Z", uploaded_at: "2026-11-02T10:00:00Z", uploaded_by: "bob"},
                {name: "ibdata1", size: 1, modified_at: "2026-11-02T10:00:00Z"},
            ], truncated: false});
        });

        test("the files uploaded marked, by whom; the others said not to be", async () => {
            up({n1: "up"});
            render(<VolumeFiles path={PATH}/>);
            const uploaded = (await screen.findByText("noble.qcow2")).closest("tr");
            expect(within(uploaded).getByText("uploaded")).toBeInTheDocument();
            expect(within(uploaded).getByText(/^by bob,/)).toBeInTheDocument();
            expect(within(screen.getByText("ibdata1").closest("tr")).getByText("not uploaded here")).toBeInTheDocument();
        });

        test("one not uploaded here deleted on a warning", async () => {
            up({n1: "up"});
            render(<VolumeFiles path={PATH}/>);
            await screen.findByText("ibdata1");
            await userEvent.click(screen.getByRole("button", {name: "Delete ibdata1"}));
            expect(screen.getByRole("dialog", {name: "Delete ibdata1?"})).toHaveTextContent(/may need it/);
            await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", {name: "Cancel"}));
            expect(deleteFile).not.toHaveBeenCalled();
            await userEvent.click(screen.getByRole("button", {name: "Delete noble.qcow2"}));
            expect(screen.getByRole("dialog", {name: "Delete noble.qcow2?"})).toHaveTextContent("It was uploaded here.");
        });

        test("a file of a name there already: asked, nothing sent until then; replaced once told", async () => {
            up({n1: "up"});
            uploadFile.mockImplementation(() => ({done: Promise.resolve(), abort: () => {}}));
            render(<VolumeFiles path={PATH}/>);
            await screen.findByText("ibdata1");
            await userEvent.upload(screen.getByLabelText("The file to upload"), new File(["x"], "ibdata1"));
            const dialog = await screen.findByRole("dialog", {name: "Replace ibdata1?"});
            expect(uploadFile).not.toHaveBeenCalled();
            await userEvent.click(within(dialog).getByRole("button", {name: "Replace it"}));
            await waitFor(() => expect(uploadFile).toHaveBeenCalledWith(PATH, "n1", expect.objectContaining({name: "ibdata1"}), expect.any(Function), {replace: true, dir: ""}));
        });

        test("cancelled, nothing is sent", async () => {
            up({n1: "up"});
            render(<VolumeFiles path={PATH}/>);
            await screen.findByText("ibdata1");
            await userEvent.upload(screen.getByLabelText("The file to upload"), new File(["x"], "ibdata1"));
            await userEvent.click(within(await screen.findByRole("dialog", {name: "Replace ibdata1?"})).getByRole("button", {name: "Cancel"}));
            expect(screen.queryByRole("dialog")).toBeNull();
            expect(uploadFile).not.toHaveBeenCalled();
        });

        test("a file the node has, written since the listing: the 409 asks as well", async () => {
            up({n1: "up"});
            uploadFile.mockImplementationOnce(() => ({done: Promise.reject(Object.assign(new Error("file exists: new.iso, not replaced"), {status: 409, exists: true})), abort: () => {}}));
            render(<VolumeFiles path={PATH}/>);
            await screen.findByText("ibdata1");
            await userEvent.upload(screen.getByLabelText("The file to upload"), new File(["x"], "new.iso"));
            expect(await screen.findByRole("dialog", {name: "Replace new.iso?"})).toBeInTheDocument();
            expect(uploadFile).toHaveBeenCalledWith(PATH, "n1", expect.objectContaining({name: "new.iso"}), expect.any(Function), {replace: false, dir: ""});
            expect(screen.queryByText(/was not uploaded/)).toBeNull();
        });

        test("a 409 of a volume not available is said, no replacing asked", async () => {
            up({n1: "up"});
            uploadFile.mockImplementationOnce(() => ({done: Promise.reject(Object.assign(new Error("volume not available: the instance is down"), {status: 409, exists: false})), abort: () => {}}));
            render(<VolumeFiles path={PATH}/>);
            await screen.findByText("ibdata1");
            await userEvent.upload(screen.getByLabelText("The file to upload"), new File(["x"], "new.iso"));
            expect(await screen.findByText(/new.iso was not uploaded: volume not available/)).toBeInTheDocument();
            expect(screen.queryByRole("dialog")).toBeNull();
        });
    });

    describe("its directories", () => {
        const TOP = [
            {name: "isos", type: "dir", size: 4096, modified_at: "2026-11-02T10:00:00Z"},
            {name: "zz.img", type: "file", size: 3, modified_at: "2026-11-02T10:00:00Z"},
            {name: "current", type: "link", target: "isos/debian.iso", size: 15, modified_at: "2026-11-02T10:00:00Z"},
        ];
        const ISOS = [{name: "debian.iso", type: "file", size: 1, modified_at: "2026-11-02T10:00:00Z", uploaded_at: "2026-11-02T10:00:00Z", uploaded_by: "bob"}];
        beforeEach(() => {
            listFiles.mockImplementation(async (_p, _n, dir) => ({items: dir === "isos" ? ISOS : TOP, truncated: false}));
            makeDirectory.mockResolvedValue();
        });

        test("the directories first, opened by a click, the URL keeping where", async () => {
            up({n1: "up"});
            render(<VolumeFiles path={PATH}/>);
            await screen.findByText("zz.img");
            const names = [...document.querySelectorAll("[data-entry]")].map((e) => e.dataset.entry);
            expect(names[0]).toBe("dir");
            expect(screen.getByText("→ isos/debian.iso")).toBeInTheDocument();
            await userEvent.click(screen.getByRole("button", {name: "isos/"}));
            expect(await screen.findByText("debian.iso")).toBeInTheDocument();
            expect(listFiles).toHaveBeenLastCalledWith(PATH, "n1", "isos");
            expect(screen.getByTestId("where")).toHaveTextContent("?view=isos");
        });

        test("opened at a directory of the URL; the breadcrumb leads back to the top", async () => {
            up({n1: "up"});
            render(<VolumeFiles path={PATH}/>, {at: "/objects?view=isos"});
            await screen.findByText("debian.iso");
            const where = screen.getByRole("navigation", {name: "Directory"});
            expect(within(where).getByText("isos")).toHaveAttribute("aria-current", "page");
            // The top, "/": the volume is the panel's title already.
            expect(within(where).queryByText("images")).toBeNull();
            expect(where).toHaveTextContent(/^\/isos$/);
            await userEvent.click(within(where).getByRole("button", {name: "/"}));
            expect(await screen.findByText("zz.img")).toBeInTheDocument();
            expect(screen.getByTestId("where")).toHaveTextContent("");
        });

        test("an upload goes to the directory shown", async () => {
            up({n1: "up"});
            uploadFile.mockImplementation(() => ({done: Promise.resolve(), abort: () => {}}));
            render(<VolumeFiles path={PATH}/>, {at: "/objects?view=isos"});
            await screen.findByText("debian.iso");
            await userEvent.upload(screen.getByLabelText("The file to upload"), new File(["x"], "ubuntu.iso"));
            await waitFor(() => expect(uploadFile).toHaveBeenCalledWith(PATH, "n1", expect.objectContaining({name: "ubuntu.iso"}), expect.any(Function), {replace: false, dir: "isos"}));
        });

        test("a directory created where shown; a name with a slash or hidden refused before asking", async () => {
            up({n1: "up"});
            render(<VolumeFiles path={PATH}/>, {at: "/objects?view=isos"});
            await screen.findByText("debian.iso");
            await userEvent.click(screen.getByRole("button", {name: "New directory"}));
            const dialog = screen.getByRole("dialog", {name: "New directory in /isos"});
            await userEvent.type(within(dialog).getByRole("textbox", {name: "Name"}), ".hidden");
            await userEvent.click(within(dialog).getByRole("button", {name: "Create"}));
            expect(within(dialog).getByText(/without \/ nor a leading dot/)).toBeInTheDocument();
            expect(makeDirectory).not.toHaveBeenCalled();
            await userEvent.clear(within(dialog).getByRole("textbox", {name: "Name"}));
            await userEvent.type(within(dialog).getByRole("textbox", {name: "Name"}), "old{Enter}");
            await waitFor(() => expect(makeDirectory).toHaveBeenCalledWith(PATH, "n1", "old", "isos"));
            await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        });

        test("deleting a directory says only an empty one goes; a link, not what it points to", async () => {
            up({n1: "up"});
            render(<VolumeFiles path={PATH}/>);
            await screen.findByText("zz.img");
            await userEvent.click(screen.getByRole("button", {name: "Delete isos"}));
            expect(screen.getByRole("dialog", {name: "Delete isos?"})).toHaveTextContent(/Only an empty directory/);
            await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", {name: "Cancel"}));
            await userEvent.click(screen.getByRole("button", {name: "Delete current"}));
            expect(screen.getByRole("dialog", {name: "Delete current?"})).toHaveTextContent(/not what it points to/);
        });

        test("a node listing no type: all files, as before", async () => {
            up({n1: "up"});
            listFiles.mockResolvedValue({items: [{type: "file", name: "a.img", size: 1, modified_at: "2026-11-02T10:00:00Z"}], truncated: true});
            render(<VolumeFiles path={PATH}/>);
            expect(await screen.findByText("a.img")).toBeInTheDocument();
            expect(screen.getByText("Only the first 1 entries are shown.")).toBeInTheDocument();
        });
    });

    describe("a file in its dialog, as a key", () => {
        const text = (s) => new Blob([s]);
        beforeEach(() => {
            listFiles.mockResolvedValue({items: [
                {name: "haproxy.cfg", type: "file", size: 12, modified_at: "2026-11-02T10:00:00Z"},
                {name: "logo.png", type: "file", size: 4, modified_at: "2026-11-02T10:00:00Z", uploaded_at: "2026-11-02T10:00:00Z", uploaded_by: "bob"},
            ], truncated: false});
            downloadFile.mockResolvedValue();
            uploadFile.mockImplementation(() => ({done: Promise.resolve(), abort: () => {}}));
        });
        // What a file sent holds, read as a browser reads it: jsdom gives a File no text().
        const written = (file) => new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsText(file);
        });
        const open = async (name, read) => {
            readFileHead.mockResolvedValue(read);
            up({n1: "up"});
            render(<VolumeFiles path={PATH}/>, {at: "/objects?view=etc"});
            await userEvent.click(await screen.findByRole("button", {name}));
            return screen.findByRole("dialog", {name});
        };

        test("text shown as it is, read from the directory shown; downloaded on its own ticket", async () => {
            const dialog = await open("haproxy.cfg", {blob: text("global\n  x 1\n"), total: 12, partial: false});
            expect(await within(dialog).findByDisplayValue(/global/)).toHaveAttribute("readonly");
            expect(readFileHead).toHaveBeenCalledWith(PATH, "n1", "haproxy.cfg", "etc", 1048576);
            expect(within(dialog).getByText(/Type: Text/)).toBeInTheDocument();
            await userEvent.click(within(dialog).getByRole("button", {name: "Download the file"}));
            expect(downloadFile).toHaveBeenCalledWith(PATH, "n1", "haproxy.cfg", "etc");
        });

        test("edited in place, written back over it, the list read again", async () => {
            const dialog = await open("haproxy.cfg", {blob: text("global\n"), total: 7, partial: false});
            await within(dialog).findByDisplayValue(/global/);
            await userEvent.click(within(dialog).getByRole("button", {name: "Edit"}));
            const box = within(dialog).getByRole("textbox", {name: "File content"});
            expect(box).not.toHaveAttribute("readonly");
            // Ending with a line feed when read: the box unchecked, the line feed kept.
            expect(within(dialog).getByRole("checkbox", {name: "No trailing line feed"})).not.toBeChecked();
            await userEvent.type(box, "defaults");
            listFiles.mockClear();
            await userEvent.click(within(dialog).getByRole("button", {name: "Save"}));
            await waitFor(() => expect(uploadFile).toHaveBeenCalledWith(PATH, "n1", expect.objectContaining({name: "haproxy.cfg"}), undefined, {replace: true, dir: "etc"}));
            expect(await written(uploadFile.mock.calls[0][2])).toBe("global\ndefaults\n");
            await waitFor(() => expect(listFiles).toHaveBeenCalled());
            expect(within(dialog).getByRole("button", {name: "Edit"})).toBeInTheDocument();
        });

        test("no line feed at its end when read: the box checked, none added; unchecked, one", async () => {
            const dialog = await open("haproxy.cfg", {blob: text("a = 1"), total: 5, partial: false});
            await within(dialog).findByDisplayValue("a = 1");
            await userEvent.click(within(dialog).getByRole("button", {name: "Edit"}));
            const box = within(dialog).getByRole("checkbox", {name: "No trailing line feed"});
            expect(box).toBeChecked();
            // Nothing changed: nothing to save; the box alone changing it, something.
            expect(within(dialog).getByRole("button", {name: "Save"})).toBeDisabled();
            await userEvent.click(box);
            expect(within(dialog).getByRole("button", {name: "Save"})).toBeEnabled();
            await userEvent.click(within(dialog).getByRole("button", {name: "Save"}));
            await waitFor(() => expect(uploadFile).toHaveBeenCalled());
            expect(await written(uploadFile.mock.calls[0][2])).toBe("a = 1\n");
        });

        test("the end of a text as asked: its line feeds dropped, or one there", () => {
            expect(withEnding("a\n\n", true)).toBe("a");
            expect(withEnding("a", true)).toBe("a");
            expect(withEnding("a", false)).toBe("a\n");
            expect(withEnding("a\n", false)).toBe("a\n");
        });

        test("binary shown in hex, not edited", async () => {
            const dialog = await open("logo.png", {blob: new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00])]), total: 5, partial: false});
            expect(await within(dialog).findByText(/Type: Binary/)).toBeInTheDocument();
            expect(within(dialog).getByRole("textbox", {name: "File content"}).value).toMatch(/^00000000 {2}89 50 4e 47 00/);
            expect(within(dialog).queryByRole("button", {name: "Edit"})).toBeNull();
        });

        test("read in part, or of CR LF lines: shown, said, not edited", async () => {
            const dialog = await open("haproxy.cfg", {blob: text("a\n"), total: 5000000, partial: true});
            expect(await within(dialog).findByText(/the first 1.0 MiB shown/)).toBeInTheDocument();
            expect(within(dialog).queryByRole("button", {name: "Edit"})).toBeNull();
        });

        test("CR LF lines: not edited, a text box would change them", async () => {
            const dialog = await open("haproxy.cfg", {blob: text("a\r\nb\r\n"), total: 6, partial: false});
            expect(await within(dialog).findByText(/CR LF/)).toBeInTheDocument();
            expect(within(dialog).queryByRole("button", {name: "Edit"})).toBeNull();
        });

        test("removed from its dialog as from its row: an uploaded one said so", async () => {
            const dialog = await open("logo.png", {blob: new Blob([new Uint8Array([0])]), total: 1, partial: false});
            await within(dialog).findByText(/Type: Binary/);
            await userEvent.click(within(dialog).getByRole("button", {name: "Delete"}));
            expect(screen.getByRole("dialog", {name: "Delete logo.png?"})).toHaveTextContent("It was uploaded here.");
        });

        test("what refuses the read is said, the certificate of the console port included", async () => {
            readFileHead.mockRejectedValue(Object.assign(new Error("the console port could not be reached"), {certificateUrl: "https://n1:1216/"}));
            up({n1: "up"});
            render(<VolumeFiles path={PATH}/>);
            await userEvent.click(await screen.findByRole("button", {name: "haproxy.cfg"}));
            const dialog = await screen.findByRole("dialog", {name: "haproxy.cfg"});
            expect(await within(dialog).findByRole("link", {name: /n1:1216/})).toBeInTheDocument();
        });
    });

    describe("a file installed from a datastore", () => {
        const INSTALLED = {name: "config.yaml", type: "file", size: 10, modified_at: "2026-11-02T10:00:00Z",
            installed_from: "dev/cfg/oc3", installed_key: "config.yaml", installed_at: "2026-11-02T10:00:00Z"};
        beforeEach(() => {
            listFiles.mockResolvedValue({items: [INSTALLED], truncated: false});
            uploadFile.mockImplementation(() => ({done: Promise.resolve(), abort: () => {}}));
        });

        test("its origin: installed, the datastore a way to its keys, the key shown in place", async () => {
            expect(fileOrigin(INSTALLED)).toEqual({kind: "installed", from: "dev/cfg/oc3", key: "config.yaml", at: INSTALLED.installed_at, changed: false});
            up({n1: "up"});
            render(<VolumeFiles path={PATH}/>);
            const row = (await screen.findByRole("button", {name: "config.yaml"})).closest("tr");
            expect(within(row).getByText("installed")).toBeInTheDocument();
            await userEvent.click(within(row).getByRole("button", {name: "Show the key config.yaml"}));
            expect(screen.getByTestId("key-shown")).toHaveTextContent("config.yaml of dev/cfg/oc3");
            await userEvent.click(within(row).getByRole("button", {name: "dev/cfg/oc3"}));
            expect(screen.getByTestId("where")).toHaveTextContent("peek=object:dev/cfg/oc3&peektab=keys");
        });

        test("an upload of its name refused before anything is sent, the key said", async () => {
            up({n1: "up"});
            render(<VolumeFiles path={PATH}/>);
            await screen.findByRole("button", {name: "config.yaml"});
            await userEvent.upload(screen.getByLabelText("The file to upload"), new File(["x"], "config.yaml"));
            expect(await screen.findByText(/config.yaml is installed from dev\/cfg\/oc3 key config.yaml: change the key/)).toBeInTheDocument();
            expect(screen.queryByRole("dialog")).toBeNull();
            expect(uploadFile).not.toHaveBeenCalled();
        });

        test("one the node says installed meanwhile: said, no replacing asked", async () => {
            up({n1: "up"});
            uploadFile.mockImplementationOnce(() => ({done: Promise.reject(Object.assign(new Error("installed file: new.yaml, not replaced"), {status: 409, installed: true})), abort: () => {}}));
            render(<VolumeFiles path={PATH}/>);
            await screen.findByRole("button", {name: "config.yaml"});
            await userEvent.upload(screen.getByLabelText("The file to upload"), new File(["x"], "new.yaml"));
            expect(await screen.findByText(/new.yaml was not uploaded: installed file/)).toBeInTheDocument();
            expect(screen.queryByRole("dialog")).toBeNull();
        });

        test("in its dialog: shown, not edited, its key a click away; deleted on a warning", async () => {
            readFileHead.mockResolvedValue({blob: new Blob(["a: 1\n"]), total: 5, partial: false});
            up({n1: "up"});
            render(<VolumeFiles path={PATH}/>);
            await userEvent.click(await screen.findByRole("button", {name: "config.yaml"}));
            const dialog = await screen.findByRole("dialog", {name: "config.yaml"});
            await within(dialog).findByDisplayValue("a: 1");
            expect(within(dialog).queryByRole("button", {name: "Edit"})).toBeNull();
            expect(dialog.querySelector("[data-installed]")).toHaveTextContent("from dev/cfg/oc3 key config.yaml · change the key");
            await userEvent.click(within(dialog).getByRole("button", {name: "Delete"}));
            expect(screen.getByRole("dialog", {name: "Delete config.yaml?"})).toHaveTextContent(/the next install writes it again/);
        });

        test("the key, from its dialog, in the place of the file", async () => {
            readFileHead.mockResolvedValue({blob: new Blob(["a: 1\n"]), total: 5, partial: false});
            up({n1: "up"});
            render(<VolumeFiles path={PATH}/>);
            await userEvent.click(await screen.findByRole("button", {name: "config.yaml"}));
            const dialog = await screen.findByRole("dialog", {name: "config.yaml"});
            await within(dialog).findByDisplayValue("a: 1");
            await userEvent.click(within(dialog).getByRole("button", {name: "Show the key config.yaml"}));
            expect(screen.queryByRole("dialog", {name: "config.yaml"})).toBeNull();
            expect(screen.getByTestId("key-shown")).toHaveTextContent("config.yaml of dev/cfg/oc3");
        });
    });

    describe("a file read", () => {
        test("its first bytes asked by a range, its whole size from the answer", async () => {
            const {readFileHead: read} = await vi.importActual("../../services/volume-files.js");
            global.fetch = vi.fn()
                .mockResolvedValueOnce(new Response(JSON.stringify({ticket: "t", port: 1216}), {status: 201}))
                .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3, 4]), {status: 206, headers: {"Content-Range": "bytes 0-3/3000000"}}));
            const head = await read(PATH, "n1", "a.iso", "isos", 4);
            expect(global.fetch.mock.calls[0][0]).toBe("/api/node/name/n1/instance/path/ns1/vol/images/file/download?dir=isos&name=a.iso");
            expect(global.fetch.mock.calls[1][1].headers.Range).toBe("bytes=0-3");
            expect(head).toMatchObject({total: 3000000, partial: true});
            expect(head.blob.size).toBe(4);
        });

        test("a node answering it whole: read up to the limit alone", async () => {
            const {readFileHead: read} = await vi.importActual("../../services/volume-files.js");
            global.fetch = vi.fn()
                .mockResolvedValueOnce(new Response(JSON.stringify({ticket: "t", port: 1216}), {status: 201}))
                .mockResolvedValueOnce(new Response(new Uint8Array(10), {status: 200, headers: {"Content-Length": "10"}}));
            const head = await read(PATH, "n1", "a.bin", "", 4);
            expect(head).toMatchObject({total: 10, partial: true});
            expect(head.blob.size).toBe(4);
        });
    });

    describe("the refusals of the node, told apart", () => {
        const answer = (status, body, type = "application/problem+json") => new Response(typeof body === "string" ? body : JSON.stringify(body), {status, headers: {"Content-Type": type}});

        test("the ticket: a file there already, by the title of its problem; a volume not available, not", async () => {
            const {requestUploadTicket} = await vi.importActual("../../services/volume-files.js");
            global.fetch = vi.fn().mockResolvedValueOnce(answer(409, {title: "File exists", detail: "a.iso exists: set replace to replace it", status: 409}))
                .mockResolvedValueOnce(answer(409, {title: "Volume not available", detail: "down", status: 409}));
            const exists = await requestUploadTicket(PATH, "n1", "a.iso").catch((e) => e);
            expect(isFileExists(exists)).toBe(true);
            expect(exists.message).toMatch(/set replace/);
            expect(isFileExists(await requestUploadTicket(PATH, "n1", "a.iso").catch((e) => e))).toBe(false);
        });
    });

    test("lists the files of a node where the volume is available", async () => {
        up({n1: "down", n2: "up"});
        render(<VolumeFiles path={PATH}/>);
        expect(await screen.findByText("noble.qcow2")).toBeInTheDocument();
        expect(listFiles).toHaveBeenCalledWith(PATH, "n2", "");
    });

    test("a volume up nowhere says so", () => {
        up({n1: "down"});
        render(<VolumeFiles path={PATH}/>);
        expect(screen.getByText(/not up on any node/)).toBeInTheDocument();
    });

    test("an upload shows its progress, and the file once there", async () => {
        up({n1: "up"});
        let finish;
        uploadFile.mockImplementation((_p, _n, _f, onProgress) => {
            onProgress(0.5);
            return {done: new Promise((resolve) => { finish = resolve; }), abort: () => {}};
        });
        render(<VolumeFiles path={PATH}/>);
        await screen.findByText("noble.qcow2");
        const file = new File(["x"], "debian.iso");
        await userEvent.upload(screen.getByLabelText("The file to upload"), file);
        expect(await screen.findByText("50%")).toBeInTheDocument();
        listFiles.mockResolvedValue({items: [{name: "debian.iso", size: 1, modified_at: "2026-10-31T07:00:00Z"}], truncated: false});
        finish();
        expect(await screen.findByText("debian.iso")).toBeInTheDocument();
        expect(screen.queryByText("50%")).toBeNull();
    });

    test("what refuses an upload is said", async () => {
        up({n1: "up"});
        // Rejected as the upload starts, when the component awaits it: made earlier,
        // the rejection would go unhandled until then.
        uploadFile.mockImplementation(() => ({done: Promise.reject(new Error("ns1/vol/images is full: grow the volume")), abort: () => {}}));
        render(<VolumeFiles path={PATH}/>);
        await screen.findByText("noble.qcow2");
        await userEvent.upload(screen.getByLabelText("The file to upload"), new File(["x"], "big.iso"));
        expect(await screen.findByText(/big.iso was not uploaded: .*is full/)).toBeInTheDocument();
    });

    test("a console port not reached tells where to accept its certificate", async () => {
        up({n1: "up"});
        const error = Object.assign(new Error("the console port could not be reached"), {certificateUrl: "https://n1:1216/"});
        uploadFile.mockImplementation(() => ({done: Promise.reject(error), abort: () => {}}));
        render(<VolumeFiles path={PATH}/>);
        await screen.findByText("noble.qcow2");
        await userEvent.upload(screen.getByLabelText("The file to upload"), new File(["x"], "a.iso"));
        expect(await screen.findByRole("link", {name: /n1:1216/})).toHaveAttribute("href", "https://n1:1216/");
    });

    test("the address of a transfer is the console port, in https", () => {
        expect(uploadUrl({ticket: "t", port: 1216}, {hostname: "n1"})).toBe("https://n1:1216/?ticket=t");
        expect(uploadUrl({ticket: "t", port: 1216, url: "wss://access.example.com/console/"})).toBe("https://access.example.com/console/?ticket=t");
    });

    test("a file is deleted once confirmed, in a dialog: the row keeps its width", async () => {
        up({n1: "up"});
        render(<VolumeFiles path={PATH}/>);
        await screen.findByText("noble.qcow2");
        await userEvent.click(screen.getByRole("button", {name: "Delete noble.qcow2"}));
        expect(deleteFile).not.toHaveBeenCalled();
        const dialog = screen.getByRole("dialog", {name: "Delete noble.qcow2?"});
        await userEvent.click(within(dialog).getByRole("button", {name: "Delete"}));
        await waitFor(() => expect(deleteFile).toHaveBeenCalledWith(PATH, "n1", "noble.qcow2", ""));
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    });
});
