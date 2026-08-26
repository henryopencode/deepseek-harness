import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { assertNoAbsoluteLinks, relativizeAbsoluteLinks } from './package-links.mjs'

test('relativizeAbsoluteLinks keeps framework links inside the application bundle', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-desktop-links-'))
  try {
    const versionDirectory = join(directory, 'Versions', 'A')
    await mkdir(versionDirectory, { recursive: true })
    await writeFile(join(versionDirectory, 'Electron Framework'), '')
    await symlink(versionDirectory, join(directory, 'Versions', 'Current'))
    await symlink(join(directory, 'Versions', 'Current', 'Electron Framework'), join(directory, 'Electron Framework'))

    await relativizeAbsoluteLinks(directory)

    await assertNoAbsoluteLinks(directory)
    assert.equal(await readlink(join(directory, 'Versions', 'Current')), 'A')
    assert.equal(await readlink(join(directory, 'Electron Framework')), 'Versions/Current/Electron Framework')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('relativizeAbsoluteLinks rejects links outside the application bundle', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-desktop-links-'))
  try {
    const link = join(directory, 'outside')
    await symlink('/tmp/dsh-desktop-outside', link)

    await assert.rejects(relativizeAbsoluteLinks(directory), /escapes its bundle/)
    assert.equal(await readlink(link), '/tmp/dsh-desktop-outside')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
