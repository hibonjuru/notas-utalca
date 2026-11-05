# Notas Utalca · GitHub Pages + Supabase

Esta carpeta es la versión para **GitHub Pages + Supabase**. Es una copia separada:
el proyecto original de Netlify (`..\Organizador`) **no fue modificado**.

## Qué incluye

- Login y registro con **RUT sin dígito verificador** + contraseña.
- Sesión persistente y cierre de sesión.
- Datos por usuario en Supabase (JSONB) con **RLS**.
- Caché local por usuario y guardado remoto con detección simple de conflictos.
- Sincronización automática: Realtime de Supabase si está habilitado y polling cada 4 segundos como respaldo.
- Respaldo manual: exportar/importar JSON.
- Modo **demo local** para probar la app sin crear un proyecto Supabase.
- Sin la vista de sincronización por QR/código; eso lo reemplaza la cuenta.
- Sin Service Worker: el modo de uso es online, con Supabase como fuente de verdad.

## Probar ahora mismo (modo demo)

No necesitas Supabase para ver la app funcionando:

```bash
cd C:\Users\SexPC\Documents\Utalca\OrganizadorGitHub
python -m http.server 8080
```

Abre `http://localhost:8080/`.

- Crea una cuenta con un RUT de 6 a 8 dígitos (sin DV) y una contraseña de 8+ caracteres.
- Las cuentas demo quedan en el `localStorage` de ese navegador.
- En modo demo puedes cargar los ramos de ejemplo desde **Mi Cuenta**.

Para cuentas reales, conecta Supabase desde el botón **Conectar con Supabase** en la pantalla de login.

## Configurar Supabase

1. Crea un proyecto en <https://supabase.com>.
2. En **Authentication → Providers → Email**:
   - Desactiva **Confirm email** (los emails internos son sintéticos).
   - Configura **Site URL** con tu URL de GitHub Pages, por ejemplo:
     `https://hibonjuru.github.io/notas-utalca/`
   - En **Redirect URLs** agrega `https://hibonjuru.github.io/notas-utalca/**` y `http://localhost:*`.
3. Abre **SQL Editor** y ejecuta completo `supabase/schema.sql`.
4. Copia el **Project URL** y la **anon public key** desde **Project Settings → API**.
5. Pégalos en la pantalla de login → **Conectar con Supabase**.
   También puedes dejarlos fijos en `cloud-config.js`:

```js
window.NOTAS_CLOUD_CONFIG = {
  url: 'https://TU-PROYECTO.supabase.co',
  anonKey: 'TU_ANON_PUBLIC_KEY',
  emailDomain: 'alumnos.utalca.cl'
};
```

La `anon key` es pública por diseño. **Nunca** pongas la `service_role` en el frontend.

### Cómo funciona el RUT

- Se normaliza a 6–8 dígitos, sin DV.
- Se mapea a un email interno determinista: `rut12345678@alumnos.utalca.cl`.
  Ese correo no se envía ni se muestra; Supabase solo lo usa como identificador de Auth.
  El dominio debe tener registros MX porque Supabase valida el correo al registrar.
- El RUT se guarda en `profiles` y se muestra enmascarado en **Mi Cuenta**.

### Limitaciones actuales

- **Vienes de Netlify:** `localStorage` no se comparte entre dominios distintos. Antes de dejar de usar Netlify, entra allá y usa **Respaldo de Datos → Exportar JSON**; luego importa ese archivo en GitHub Pages desde **Mi Cuenta → Importar respaldo JSON**.
  Si el botón viejo no descarga el archivo (usa `navigator.share` en iPhone), puedes usar **Copiar Código Sync** o el botón **Copiar** de la hoja de compartir, y luego en GitHub Pages usar **Mi Cuenta → Pegar respaldo desde portapapeles**.
  En PC también puedes abrir la consola del navegador en Netlify y ejecutar:
  `copy(localStorage.getItem('utalca_organizador_v4'))`
  y guardar el texto como un archivo `.json`.
- Sin DV no se puede validar el dígito verificador; solo el largo.
- No hay recuperación automática de contraseña porque no se pide email real.
  Si olvidas la contraseña, el administrador debe restablecerla desde Supabase.
- No hay eliminación de cuenta desde la UI; sí “borrar todos mis ramos”.
- No hay offline real. La app necesita internet para Supabase.
- El estado se guarda completo como JSONB. Si dos dispositivos editan exactamente al mismo tiempo
  puede aparecer un conflicto; se avisa y se puede recargar desde la nube. La app intenta aplicar
  automáticamente los cambios remotos cuando no hay ediciones locales pendientes.

### Sincronización automática

La app escucha cambios de `user_state` y además consulta la nube cada 4 segundos. También
sincroniza al volver a la app o al enfocar la ventana.

Para que la actualización sea instantánea, habilita Realtime para la tabla. El bloque 7 de
`supabase/schema.sql` ya lo hace; si ya ejecutaste el esquema antes, puedes correr solo:

```sql
alter publication supabase_realtime add table public.user_state;
```

Si no lo haces, igual funciona con polling cada 4 segundos.

## Publicar en GitHub Pages

El repositorio aún no existe en GitHub. La carpeta local ya está inicializada como
repositorio Git con commits y el remoto configurado. Solo falta crear el repositorio
remoto y hacer push:

```bash
cd C:\Users\SexPC\Documents\Utalca\OrganizadorGitHub
git push -u origin main
```

Si empiezas desde cero en otra copia:

```bash
git init -b main
git add .
git commit -m "feat: GitHub Pages + Supabase auth"
git remote add origin https://github.com/hibonjuru/notas-utalca.git
git push -u origin main
```

En GitHub:

1. **Settings → Pages**.
2. **Source:** Deploy from a branch.
3. **Branch:** `main` / `(root)`.
4. Guardar y esperar el deploy.
5. Abrir `https://hibonjuru.github.io/notas-utalca/`.

El archivo `.nojekyll` evita que GitHub Pages procese el sitio con Jekyll.
Las rutas del proyecto son relativas, así que funcionan bajo el subpath del repo.

### Cache de GitHub Pages

GitHub Pages puede cachear assets por algunos minutos. Los scripts y estilos
llevan `?v=1`; cuando cambies `app.js`, `styles.css`, `auth.js`, etc., sube ese
número en `index.html` para forzar la recarga.

## Tests

```bash
node test_app.js
node --check app.js
node --check auth_utils.js
node --check cloud.js
node --check auth.js
```

El workflow `.github/workflows/tests.yml` ejecuta lo mismo en cada push/PR.

## Seguridad

- RLS activo en `profiles` y `user_state`.
- Cada usuario solo puede leer/escribir su propia fila.
- No se guardan contraseñas en el frontend; Supabase las hashea.
- En modo demo, la contraseña se guarda como hash SHA-256 (o FNV si el navegador
  no tiene Web Crypto). Es solo para pruebas, no es seguridad real.
- El RUT es dato personal: no lo pongas en URLs, logs ni repositorios públicos.
- Prueba siempre con **dos cuentas** que A no pueda ver los datos de B.

## Archivos principales

```text
index.html                 pantalla de login + app
styles.css                 estilos de login, cuenta y app
app.js                     motor de cálculo + UI
auth_utils.js              normalización de RUT y contraseña
cloud.js                   adaptador Supabase / demo
cloud-config.js            URL y anon key públicas
auth.js                    formulario de login/registro/configuración
supabase/schema.sql        tablas, RLS y trigger
test_app.js                tests del motor + RUT
.github/workflows/tests.yml CI
```
