-- Pruebas de la migración 0011. Ejecutar SOLO sobre una copia de la base: crea datos de prueba.
\set ON_ERROR_STOP 1
insert into apoderados (id,nombre,apellidos,telefono,email,relacion,comuna,canal_preferido,consent_contact,consent_at)
values ('00000000-0000-0000-0000-00000000f001','Carolina','Pérez','+56911111111','caro@x.cl','MAMA','La Cisterna','WHATSAPP',true,now());
insert into atletas (id,apoderado_id,nombre,apellidos,fecha_nacimiento,firehouse_actual) values
 ('10000000-0000-0000-0000-00000000f001','00000000-0000-0000-0000-00000000f001','Sofía','Rojas','2018-01-01',false),
 ('10000000-0000-0000-0000-00000000f002','00000000-0000-0000-0000-00000000f001','Martina','Rojas','2019-01-01',false);
insert into casos_crm (id, atleta_id,journey,estado,como_conocio) values
 ('20000000-0000-0000-0000-00000000f001','10000000-0000-0000-0000-00000000f001','CLASE_PRUEBA_STAR','NUEVO','X');
insert into cargos (id, apoderado_id, atleta_id, programa_codigo, concepto_codigo, temporada, periodo, descripcion, monto, vencimiento) values
 ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000f001','10000000-0000-0000-0000-00000000f001','STAR','INSCRIPCION',2026,null,'Inscripción Firehouse Star 2026',10000,'2026-10-03'),
 ('30000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-00000000f001','10000000-0000-0000-0000-00000000f001','STAR','MENSUALIDAD',2026,'2026-10-01','Mensualidad octubre 2026',30000,'2030-10-05'),
 ('30000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-00000000f001','10000000-0000-0000-0000-00000000f002','STAR','MENSUALIDAD',2026,'2026-09-01','Mensualidad septiembre 2026',30000,'2026-09-05');
do $$ declare ok boolean := false; begin
  begin insert into cargos (apoderado_id, atleta_id, programa_codigo, concepto_codigo, temporada, periodo, descripcion, monto) values
   ('00000000-0000-0000-0000-00000000f001','10000000-0000-0000-0000-00000000f001','STAR','MENSUALIDAD',2026,'2026-10-01','dup',30000);
  exception when unique_violation then ok := true; end;
  assert ok, 'mensualidad duplicada debe rechazarse'; raise notice 'OK mensualidad duplicada rechazada'; end $$;
do $$ declare ok boolean := false; begin
  begin perform fn_crear_pago_cuenta('00000000-0000-0000-0000-00000000f001', array['30000000-0000-0000-0000-000000000001']::uuid[], 'MERCADOPAGO', 'PAGO-T1');
  exception when others then ok := sqlerrm like '%vencida_mas_antigua%'; end;
  assert ok, 'debe exigir la vencida'; raise notice 'OK exige incluir la mensualidad vencida más antigua'; end $$;
do $$ declare r jsonb; ok boolean := false; begin
  r := fn_crear_pago_cuenta('00000000-0000-0000-0000-00000000f001', array['30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000003']::uuid[], 'MERCADOPAGO', 'PAGO-T2');
  assert (r->>'monto_total')::int = 40000, 'total 40000';
  begin perform fn_confirmar_pago_cuenta('PAGO-T2','mp-1',100,'CLP',null,'{}'); exception when others then ok := sqlerrm like '%monto_o_moneda%'; end;
  assert ok and (select estado from pagos where commerce_order='PAGO-T2')='PENDIENTE', 'monto adulterado';
  perform fn_confirmar_pago_cuenta('PAGO-T2','mp-1',40000,'CLP','visa','{}');
  r := fn_confirmar_pago_cuenta('PAGO-T2','mp-1',40000,'CLP','visa','{}');
  assert (r->>'repetido')::boolean, 'idempotente';
  assert (select estado from cargos where id='30000000-0000-0000-0000-000000000001')='PAGADO', 'inscripcion pagada';
  assert exists (select 1 from inscripciones where atleta_id='10000000-0000-0000-0000-00000000f001' and estado='ACTIVA' and programa_codigo='STAR'), 'inscripcion creada';
  assert (select estado from casos_crm where id='20000000-0000-0000-0000-00000000f001')='INSCRITO', 'caso inscrito';
  assert (select count(*) from interacciones where caso_id='20000000-0000-0000-0000-00000000f001' and nota like 'Pago recibido:%')=1, 'nota de pago';
  raise notice 'OK pago MP: monto validado, idempotente, inscripción creada y caso Inscrito'; end $$;
do $$ declare ok boolean := false; begin
  begin perform fn_crear_pago_cuenta('00000000-0000-0000-0000-00000000f001', array['30000000-0000-0000-0000-000000000001']::uuid[], 'MERCADOPAGO', 'PAGO-T3');
  exception when others then ok := sqlerrm like '%cargos_invalidos%'; end;
  assert ok, 'no se puede pagar un cargo ya pagado'; raise notice 'OK no permite pagar un cargo ya pagado'; end $$;
do $$ declare r jsonb; begin
  r := fn_registrar_pago_manual('00000000-0000-0000-0000-00000000f001', array['30000000-0000-0000-0000-000000000002']::uuid[], 'EFECTIVO', 'Recibido en la academia', null);
  assert (select estado from cargos where id='30000000-0000-0000-0000-000000000002')='PAGADO', 'manual pagado';
  assert (select medio from pagos where id=(r->>'pago_id')::uuid)='EFECTIVO';
  raise notice 'OK pago manual en efectivo'; end $$;
do $$ begin
  perform fn_marcar_pago_cuenta_reembolsado('PAGO-T2');
  assert (select estado from cargos where id='30000000-0000-0000-0000-000000000003')='PENDIENTE', 'reembolso devuelve a pendiente';
  assert (select saldo from v_cargos_saldo where id='30000000-0000-0000-0000-000000000001')=10000, 'saldo repuesto';
  raise notice 'OK reembolso: los cargos vuelven a quedar pendientes'; end $$;
