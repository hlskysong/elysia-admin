declare namespace Api {
    namespace SystemDeploy {
        type LocationKind = 'home' | 'admin' | 'api' | 'rustfs' | 'custom'
        type LocationServe = 'proxy' | 'static'

        interface LocationItem {
            kind: LocationKind
            name?: string
            serve?: LocationServe
            path: string
            port?: number
            root?: string
            maxBody?: string
        }

        interface SiteItem {
            siteId?: number
            name?: string
            serverName?: string
            wwwRoot?: string
            webRoot?: string
            certDir?: string
            email?: string
            sslAutoRenew?: boolean
            reloadNginx?: boolean
            useBaota?: boolean
            httpRedirect?: boolean
            locations?: LocationItem[]
            certExpireAt?: string
            lastRenewAt?: string
            lastRenewMsg?: string
            remark?: string
            webRootAbs?: string
            certDirAbs?: string
            challengeDir?: string
        }

        interface PreviewResult {
            httpOnly: string
            ssl: string
            challengeDir: string
            certDir: string
        }

        interface CertItem {
            certId?: number
            siteId?: number
            issuer?: string
            serialNumber?: string
            fingerprint?: string
            notBefore?: string
            notAfter?: string
            success?: boolean
            isCurrent?: boolean
            renewSource?: string
            message?: string
            createTime?: string
        }

        interface CertPage {
            list: CertItem[]
            total: number
        }
    }
}
