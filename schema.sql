-- Ejecutar dentro de la base indicada por MYSQL_DB.

CREATE TABLE IF NOT EXISTS usuarios (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  matricula VARCHAR(50) NULL,
  nombre VARCHAR(100) NOT NULL,
  apellido VARCHAR(100) NOT NULL,
  apellido2 VARCHAR(100) NULL,
  correo VARCHAR(150) NOT NULL,
  usuario VARCHAR(50) NOT NULL,
  pass_hash VARCHAR(255) NOT NULL,
  telefono VARCHAR(20) NULL,
  rol ENUM('alumno', 'maestro') NOT NULL DEFAULT 'alumno',
  activo TINYINT(1) NOT NULL DEFAULT 0,
  token_confirmacion VARCHAR(64) NULL,
  token_creado DATETIME NULL,
  fecha_registro TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_usuarios_matricula (matricula),
  UNIQUE KEY uq_usuarios_correo (correo),
  UNIQUE KEY uq_usuarios_usuario (usuario),
  UNIQUE KEY uq_usuarios_token (token_confirmacion)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS carreras (
  id_carrera INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre_carrera VARCHAR(150) NOT NULL,
  PRIMARY KEY (id_carrera),
  UNIQUE KEY uq_carreras_nombre (nombre_carrera)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS grupos (
  id_grupo INT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_carrera INT UNSIGNED NOT NULL,
  nombre_grupo VARCHAR(50) NOT NULL,
  PRIMARY KEY (id_grupo),
  UNIQUE KEY uq_grupos_carrera_nombre (id_carrera, nombre_grupo),
  CONSTRAINT fk_grupos_carrera
    FOREIGN KEY (id_carrera) REFERENCES carreras(id_carrera)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS grupo_alumno (
  id_grupo INT UNSIGNED NOT NULL,
  id_alumno INT UNSIGNED NOT NULL,
  PRIMARY KEY (id_grupo, id_alumno),
  CONSTRAINT fk_grupo_alumno_grupo
    FOREIGN KEY (id_grupo) REFERENCES grupos(id_grupo)
    ON DELETE CASCADE,
  CONSTRAINT fk_grupo_alumno_usuario
    FOREIGN KEY (id_alumno) REFERENCES usuarios(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS materias (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  materia VARCHAR(100) NOT NULL,
  maestro VARCHAR(100) NOT NULL,
  grado VARCHAR(20) NOT NULL,
  grupo VARCHAR(20) NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS perfiles_aprendizaje (
  id_perfil INT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_alumno INT UNSIGNED NOT NULL,
  resultado_final VARCHAR(50) NOT NULL,
  porcentaje_visual TINYINT UNSIGNED NOT NULL,
  porcentaje_auditivo TINYINT UNSIGNED NOT NULL,
  porcentaje_kinestesico TINYINT UNSIGNED NOT NULL,
  actualizado TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id_perfil),
  UNIQUE KEY uq_perfiles_alumno (id_alumno),
  CONSTRAINT fk_perfiles_usuario
    FOREIGN KEY (id_alumno) REFERENCES usuarios(id)
    ON DELETE CASCADE,
  CONSTRAINT chk_perfiles_visual CHECK (porcentaje_visual <= 100),
  CONSTRAINT chk_perfiles_auditivo CHECK (porcentaje_auditivo <= 100),
  CONSTRAINT chk_perfiles_kinestesico CHECK (porcentaje_kinestesico <= 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS archivos_docentes (
  id_archivo INT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_maestro INT UNSIGNED NOT NULL,
  nombre_archivo VARCHAR(255) NOT NULL,
  ruta_almacenamiento VARCHAR(255) NOT NULL,
  tipo_archivo VARCHAR(80) NOT NULL,
  fecha_subida TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  estado_analisis ENUM('pendiente', 'procesando', 'completado') NOT NULL DEFAULT 'pendiente',
  contenido_extraido MEDIUMTEXT NULL,
  PRIMARY KEY (id_archivo),
  KEY idx_archivos_maestro (id_maestro),
  CONSTRAINT fk_archivos_maestro
    FOREIGN KEY (id_maestro) REFERENCES usuarios(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS asignaciones_materiales (
  id_archivo INT UNSIGNED NOT NULL,
  id_grupo INT UNSIGNED NOT NULL,
  asignado TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_archivo, id_grupo),
  CONSTRAINT fk_asignacion_archivo
    FOREIGN KEY (id_archivo) REFERENCES archivos_docentes(id_archivo)
    ON DELETE CASCADE,
  CONSTRAINT fk_asignacion_grupo
    FOREIGN KEY (id_grupo) REFERENCES grupos(id_grupo)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS interacciones_ia (
  id_interaccion BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_usuario INT UNSIGNED NOT NULL,
  prompt_usuario TEXT NOT NULL,
  respuesta_ia TEXT NOT NULL,
  fecha_interaccion TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_interaccion),
  KEY idx_interacciones_usuario_fecha (id_usuario, fecha_interaccion),
  CONSTRAINT fk_interacciones_usuario
    FOREIGN KEY (id_usuario) REFERENCES usuarios(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS google_identities (
  subject VARCHAR(255) NOT NULL PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL UNIQUE,
  pending_teacher TINYINT(1) NOT NULL DEFAULT 0,
  CONSTRAINT fk_google_user FOREIGN KEY (user_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
