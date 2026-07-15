# Arquitectura de navegacion dinamica en arbol

## Objetivo

El sidebar del ERP se construye desde registros normalizados y admite cualquier cantidad de niveles. El frontend no contiene limites de profundidad ni necesita agregar bloques HTML cuando aparezca una carpeta o pagina nueva.

En el estado actual, los registros se derivan de `scripts/config/navigation.js` para conservar todas las rutas existentes. La fuente futura sera una tabla de base de datos a traves del repositorio de menu. Supabase permanece desactivado y no se creo ni ejecuto SQL.

## Contrato de un nodo

| Campo | Uso |
| --- | --- |
| `id` | Identificador unico e inmutable del nodo. |
| `parentId` | Id de la carpeta padre. Es `null` solo en nodos raiz. |
| `orden` | Orden numerico entre hermanos. |
| `icono` | Codigo de icono o identificador visual. |
| `nombre` | Texto visible en el menu. |
| `ruta` | Id de ruta. Es obligatoria para paginas y opcional para carpetas. |
| `tipo` | `carpeta` o `pagina`. |
| `permisos` | Lista de roles autorizados; `*` permite todos. |
| `activo` | Permite ocultar un nodo sin eliminarlo. |
| `metadata` | Estado, origen, descripcion y datos complementarios de la pagina. |

## Modelo futuro de base de datos

La persistencia futura debe separar dos responsabilidades:

- `app_menu_items`: estructura del arbol, nombre, ruta, tipo, orden, icono, estado y `parent_id` autorreferenciado.
- `app_menu_role_permissions`: relacion entre un nodo de menu y los roles que pueden visualizarlo.

Una consulta o vista de lectura entregara al frontend los campos del contrato, incluyendo `permisos` como arreglo. No se define SQL en esta fase.

## Flujo del frontend

1. `menu-service.js` solicita registros al proveedor configurado.
2. Si la base no esta disponible, conserva los registros `LOCAL_CONFIG`.
3. `navigation-tree.js` valida ids, padres, tipos, rutas, permisos y ciclos.
4. Los nodos se filtran por el rol activo.
5. Los hermanos se ordenan por `orden` y luego por `nombre`.
6. `layout.js` renderiza carpetas y paginas recursivamente.
7. `state.js` conserva nodos abiertos y bloquea rutas no autorizadas.

## Permisos actuales demo

Los roles visuales se normalizan a `ADMIN`, `SOPORTE`, `CONTABILIDAD`, `COMERCIAL`, `OPERACIONES` y `BODEGA`. El administrador puede ver todo. Esto es control visual demo; Auth y RLS reales siguen pendientes.

La seguridad definitiva no debe depender solo del menu. Cuando exista backend, cada consulta y accion debera validar permisos en servidor y mediante RLS.

## Agregar un modulo futuro

Para una carpeta nueva se inserta un nodo `tipo: carpeta` con su `parentId`. Para una pagina se inserta un nodo `tipo: pagina`, su `ruta` y sus permisos. El constructor recursivo la mostrara en la profundidad indicada por la cadena de padres.

Si la ruta usa una pantalla generica, el shell puede mostrar su placeholder a partir de `metadata`. Si necesita una interfaz de negocio especializada, esa pantalla sigue requiriendo su modulo de render; la estructura del menu no requiere cambios.

## Protecciones

- Ids duplicados bloquean la carga nueva.
- Padres inexistentes bloquean la carga nueva.
- Una pagina no puede ser padre.
- Ciclos bloquean la carga nueva.
- Paginas sin ruta bloquean la carga nueva.
- Nodos sin permisos bloquean la carga nueva.
- Un fallo del proveedor conserva el menu local estable.
- Supabase, Auth y RLS continúan desactivados.
