UPDATE public.doctors
SET specialties = ARRAY[array_to_string(specialties, ' ')]
WHERE array_length(specialties, 1) > 1;