import { readdir, readlink, symlink, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** Return whether a resolved link destination remains inside its application bundle. */
function isInside(directory, path) {
  const relativePath = relative(directory, path)
  return relativePath === '' || (!relativePath.startsWith(`..${sep}`) && relativePath !== '..' && !isAbsolute(relativePath))
}

/** Rewrite build-host absolute links within an application bundle as bundle-relative links. */
export async function relativizeAbsoluteLinks(directory, bundleRoot = directory) {
  const resolvedRoot = resolve(bundleRoot)
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isSymbolicLink()) {
      const target = await readlink(path)
      if (!isAbsolute(target)) continue
      const destination = resolve(dirname(path), target)
      if (!isInside(resolvedRoot, destination)) {
        throw new Error(`desktop application link escapes its bundle: ${path} -> ${target}`)
      }
      await unlink(path)
      await symlink(relative(dirname(path), destination), path)
    } else if (entry.isDirectory()) {
      await relativizeAbsoluteLinks(path, resolvedRoot)
    }
  }
}

/** Reject application links that would resolve only on the machine that built the archive. */
export async function assertNoAbsoluteLinks(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isSymbolicLink()) {
      const target = await readlink(path)
      if (isAbsolute(target)) throw new Error(`desktop package contains an absolute link: ${path} -> ${target}`)
    } else if (entry.isDirectory()) {
      await assertNoAbsoluteLinks(path)
    }
  }
}
