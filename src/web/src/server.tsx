import { Hono } from 'hono'
import type { FC } from 'hono/jsx'
import { stream } from 'hono/streaming'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const Layout: FC<{ title: string }> = ({ title, children }) => (
  <html>
    <head>
      <meta charset="utf-8" />
      <title>{title}</title>
      <style>{`
        :root { color-scheme: light dark; }
        body {
          font-family: system-ui, sans-serif;
          max-width: 50rem;
          margin: 3rem auto;
          padding: 0 1rem;
          line-height: 1.5;
        }
        h1 { color: #1793d1; }
        label { display: block; margin: 1.25rem 0 0.5rem; font-weight: 500; }
        input[type="text"] {
          font: inherit; padding: 0.5rem 0.75rem; width: 18rem;
          border: 1px solid #888; border-radius: 0.25rem;
        }
        button {
          font: inherit; padding: 0.6rem 1.25rem; margin-top: 1.25rem;
          background: #1793d1; color: white; border: 0; border-radius: 0.25rem;
          cursor: pointer;
        }
        button:disabled { opacity: 0.5; cursor: progress; }
        code {
          background: color-mix(in srgb, currentColor 10%, transparent);
          padding: 0.1em 0.3em; border-radius: 0.2em;
        }
        pre {
          background: #111; color: #c8ffc8; padding: 1rem;
          margin-top: 1.5rem; max-height: 40rem; overflow: auto;
          white-space: pre-wrap; border-radius: 0.25rem;
        }
      `}</style>
    </head>
    <body>{children}</body>
  </html>
)

function buildConfig(hostname: string) {
  return {
    'archinstall-language': 'English',
    hostname,
    kernels: ['linux'],
    ntp: true,
    offline: false,
    packages: [],
    'parallel downloads': 0,
    audio_config: null,
    bootloader_config: {
      bootloader: 'Systemd-boot',
      uki: false,
      removable: false,
    },
    locale_config: { kb_layout: 'us', sys_lang: 'en_US', sys_enc: 'UTF-8' },
    network_config: { type: 'nm' },
    swap: { enabled: false },
    mirror_config: {
      mirror_regions: {},
      custom_servers: [],
      custom_repositories: [],
      optional_repositories: [],
    },
    profile_config: { profile: { main: 'Minimal' } },
    disk_config: {
      config_type: 'default_layout',
      device_modifications: [
        {
          device: '/dev/vda',
          wipe: true,
          partitions: [
            {
              obj_id: randomUUID(),
              status: 'create',
              type: 'primary',
              fs_type: 'fat32',
              flags: ['boot', 'esp'],
              btrfs: [],
              mount_options: [],
              dev_path: null,
              mountpoint: '/boot',
              start: { unit: 'MiB', value: 1, sector_size: { value: 512, unit: 'B' } },
              size: { unit: 'MiB', value: 512, sector_size: { value: 512, unit: 'B' } },
            },
            {
              obj_id: randomUUID(),
              status: 'create',
              type: 'primary',
              fs_type: 'ext4',
              flags: [],
              btrfs: [],
              mount_options: [],
              dev_path: null,
              mountpoint: '/',
              start: { unit: 'MiB', value: 513, sector_size: { value: 512, unit: 'B' } },
              size: { unit: 'GiB', value: 28, sector_size: { value: 512, unit: 'B' } },
            },
          ],
        },
      ],
    },
  }
}

const CREDS = { '!root-password': 'archlinux' }

const app = new Hono()

app.get('/', (c) =>
  c.html(
    <Layout title="Arch Installer">
      <h1>Arch Installer</h1>
      <p>
        Minimal sanity-check install. Wipes <code>/dev/vda</code>, writes a
        bootable Arch with the chosen hostname and root password{' '}
        <code>archlinux</code>.
      </p>

      <form id="form">
        <label>
          Hostname:
          <br />
          <input
            type="text"
            id="hostname"
            value="bicycle-test"
            required
            pattern="[a-zA-Z0-9-]+"
          />
        </label>
        <button id="go" type="submit">Install</button>
      </form>

      <pre id="out" />

      <script
        dangerouslySetInnerHTML={{
          __html: `
        const form = document.getElementById('form');
        const out  = document.getElementById('out');
        const go   = document.getElementById('go');
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          out.textContent = '';
          go.disabled = true;
          go.textContent = 'Installing…';
          const hostname = document.getElementById('hostname').value;
          try {
            const res = await fetch('/api/install?hostname=' +
                                    encodeURIComponent(hostname));
            const reader = res.body.getReader();
            const dec = new TextDecoder();
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              out.textContent += dec.decode(value, { stream: true });
              out.scrollTop = out.scrollHeight;
            }
          } finally {
            go.disabled = false;
            go.textContent = 'Install';
          }
        });
        `,
        }}
      />
    </Layout>,
  ),
)

app.get('/api/preview', (c) => {
  const hostname = c.req.query('hostname') ?? 'bicycle-test'
  return c.json({ config: buildConfig(hostname), creds: CREDS })
})

app.get('/api/install', (c) =>
  stream(c, async (s) => {
    const hostname = c.req.query('hostname') ?? 'bicycle-test'
    if (!/^[a-zA-Z0-9-]+$/.test(hostname)) {
      await s.writeln(`invalid hostname: ${hostname}`)
      return
    }

    const config = buildConfig(hostname)
    const dir = await mkdtemp(join(tmpdir(), 'archinstall-'))
    const cfgPath = join(dir, 'config.json')
    const credsPath = join(dir, 'creds.json')
    await writeFile(cfgPath, JSON.stringify(config, null, 2))
    await writeFile(credsPath, JSON.stringify(CREDS))

    await s.writeln(`hostname: ${hostname}`)
    await s.writeln(`config:   ${cfgPath}`)
    await s.writeln(`creds:    ${credsPath}`)
    await s.writeln('--- archinstall ---')

    const proc = Bun.spawn(
      ['archinstall', '--config', cfgPath, '--creds', credsPath, '--silent'],
      { stdout: 'pipe', stderr: 'pipe' },
    )

    const pump = async (src: ReadableStream<Uint8Array> | null) => {
      if (!src) return
      const reader = src.getReader()
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        await s.write(value)
      }
    }

    await Promise.all([pump(proc.stdout), pump(proc.stderr)])
    const code = await proc.exited
    await s.writeln(`--- archinstall exited ${code} ---`)
  }),
)

export default { port: 8080, fetch: app.fetch }
