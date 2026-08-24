declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

declare module '@tabler/icons-react/dist/esm/icons/IconMicrophone.mjs' {
  import type { JSX, SVGProps } from 'react'

  const IconMicrophone: (
    props: Omit<SVGProps<SVGSVGElement>, 'stroke'> & { size?: number | string; stroke?: number | string },
  ) => JSX.Element
  export default IconMicrophone
}
