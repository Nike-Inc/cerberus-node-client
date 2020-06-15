declare module 'cerberus-node-client' {
    interface CerberusClientOptions {
        hostUrl: string;
        region?: string;
        token?: string;
        debug?: boolean;
    }

    interface ListKeyResult {
        keys: string[];
    }

    interface SecureFileSummaries {
        sdbox_id: string;
        path: string;
        size_in_bytes: number;
        name: string;
        created_by: string;
        created_ts: string;
        last_updated_by: string;
        last_updated_ts: string;
    }

    interface ListFileResult {
        has_next: boolean;
        next_offset: string;
        limit: number;
        offset: number;
        file_count_in_result: number;
        total_file_count: number;
        secure_file_summaries: SecureFileSummaries[];
    }

    class CerberusClient {
        constructor(options: CerberusClientOptions);
        writeSecureData(path: string, data: Record<string, string>): Promise<void>;
        getSecureData(path: string): Promise<Record<string, string>>;
        deleteSecureData(path: string): Promise<void>;
        listPathsForSecureData(path: string): Promise<ListKeyResult>;
        listFile(path: string): Promise<ListFileResult>;
        readFile(path: string): Promise<Buffer | string>;
        writeFile(path: string, data: string | Buffer): Promise<object>;
        deleteFile(path: string): Promise<object>;
    }

    export = CerberusClient;
}
