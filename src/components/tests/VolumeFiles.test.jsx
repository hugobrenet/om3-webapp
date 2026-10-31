import React from "react";
import {render, screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {VolumeFiles} from "../VolumeFiles.jsx";
import {deleteFile, filesUrl, listFiles, uploadFile} from "../../services/volume-files.js";
import useEventStore from "../../hooks/useEventStore.js";

vi.mock("../../services/volume-files.js", async (importOriginal) => ({
    ...(await importOriginal()),
    listFiles: vi.fn(),
    deleteFile: vi.fn(),
    uploadFile: vi.fn(),
}));

const PATH = "ns1/vol/images";
const up = (nodes) => useEventStore.setState({
    objectInstanceStatus: {[PATH]: Object.fromEntries(Object.entries(nodes).map(([n, avail]) => [n, {avail}]))},
});

describe("VolumeFiles", () => {
    beforeEach(() => {
        listFiles.mockResolvedValue([{name: "noble.qcow2", size: 1048576, modified_at: "2026-10-31T07:00:00Z"}]);
        deleteFile.mockResolvedValue();
    });

    test("the address of a file holds what it is named, encoded", () => {
        expect(filesUrl(PATH, "n1", "a b.img")).toBe("/api/node/name/n1/instance/path/ns1/vol/images/file?name=a%20b.img");
    });

    test("lists the files of a node where the volume is available", async () => {
        up({n1: "down", n2: "up"});
        render(<VolumeFiles path={PATH}/>);
        expect(await screen.findByText("noble.qcow2")).toBeInTheDocument();
        expect(listFiles).toHaveBeenCalledWith(PATH, "n2");
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
        listFiles.mockResolvedValue([{name: "debian.iso", size: 1, modified_at: "2026-10-31T07:00:00Z"}]);
        finish();
        expect(await screen.findByText("debian.iso")).toBeInTheDocument();
        expect(screen.queryByText("50%")).toBeNull();
    });

    test("what refuses an upload is said", async () => {
        up({n1: "up"});
        uploadFile.mockReturnValue({done: Promise.reject(new Error("ns1/vol/images is full: grow the volume")), abort: () => {}});
        render(<VolumeFiles path={PATH}/>);
        await screen.findByText("noble.qcow2");
        await userEvent.upload(screen.getByLabelText("The file to upload"), new File(["x"], "big.iso"));
        expect(await screen.findByText(/big.iso was not uploaded: .*is full/)).toBeInTheDocument();
    });

    test("a file is deleted once confirmed", async () => {
        up({n1: "up"});
        render(<VolumeFiles path={PATH}/>);
        await screen.findByText("noble.qcow2");
        await userEvent.click(screen.getByRole("button", {name: "Delete"}));
        expect(deleteFile).not.toHaveBeenCalled();
        await userEvent.click(screen.getByRole("button", {name: "Delete"}));
        await waitFor(() => expect(deleteFile).toHaveBeenCalledWith(PATH, "n1", "noble.qcow2"));
    });
});
